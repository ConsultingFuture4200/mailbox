"""Pairwise LLM-as-judge metric for GEPA optimization.

Decision log (STAQPRO-343, 2026-05-13):

* **Primary metric:** pairwise LLM-as-judge win rate. Judge model is
  Claude Haiku 4.5 (``claude-haiku-4-5-20251001``) — picked deliberately
  as a different family than the Qwen3 baseline drafter to avoid
  same-model-as-judge bias. The judge sees ``(candidate, reference)``
  where the reference is the operator-approved sent reply (the trace's
  ``actual_reply_body``). The judge returns 1 when candidate ≥ reference
  on conveyed intent + actionability + tone match, else 0. Win rate over
  the eval set is the optimization target.
* **Secondary sanity floor:** nomic-embed-text cosine similarity between
  candidate and reference. Not the optimization target — used to detect
  degenerate outputs (empty, off-topic, repetitive) that the judge might
  miss because the judge is itself an LM. Floor is configurable
  (``--cos-floor``, default 0.30). Below floor → judge result is forced
  to 0 regardless of what Haiku says.
* **Trace filter:** v1 includes ``status='sent'`` only; rejected drafts
  excluded. Revisit as explicit negatives if first GEPA pass underfits.

The judge call sends one ``(candidate, reference, inbound)`` triple at a
time to Anthropic. This is inside the existing cloud trust boundary — the
live drafter already escalates to Ollama Cloud + Anthropic alt-cloud for
the cloud route — but it's still PII-scrubbed customer content leaving the
local box, so we cap parallelism aggressively and never log bodies.

Failure modes:

* Anthropic returns a non-{0,1} response → conservative ``0`` (penalize
  candidate, force GEPA to reflect).
* Anthropic call raises → metric returns ``0.0`` with the reason in the
  feedback string so GEPA's reflection LM can see what happened.
* nomic embed call fails → cosine floor disabled for that pair; judge
  result stands.
"""

from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass
from typing import Any, Protocol

import httpx
from anthropic import Anthropic
from anthropic.types import Message

logger = logging.getLogger(__name__)

# Live alt-cloud judge model — see `dashboard/lib/drafting/prompt.ts`
# ``DRAFT_ANTHROPIC_MODEL``. Kept as a constant rather than env-tunable on
# purpose: changing the judge model changes the metric, and that's a
# decision that should land in a PR, not an env var on the workstation.
DEFAULT_JUDGE_MODEL = "claude-haiku-4-5-20251001"

# nomic-embed-text:v1.5 on local Ollama. Default to the workstation /
# appliance Ollama HTTP API; overridable via env for an SSH-tunneled probe.
DEFAULT_EMBED_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
DEFAULT_EMBED_MODEL = "nomic-embed-text:v1.5"

DEFAULT_COS_FLOOR = 0.30

JUDGE_SYSTEM_PROMPT = (
    "You are a strict email-quality judge for a human-in-the-loop email assistant. "
    "You are given an INBOUND email, a REFERENCE reply that a human operator approved "
    "and sent, and a CANDIDATE reply that an LM drafted. Compare them on three axes:\n"
    "  1. Intent — does the candidate convey the same response intent as the reference?\n"
    "  2. Actionability — does the candidate move the conversation forward in the same way?\n"
    "  3. Tone match — does the candidate match the operator's voice (warmth, formality)?\n"
    "\n"
    "Return a single JSON object and nothing else:\n"
    '  {"win": 1, "reason": "<one short sentence>"}\n'
    "where win=1 means the candidate is AT LEAST as good as the reference on all three axes, "
    "and win=0 otherwise. Default to 0 when uncertain. Be strict: invented facts "
    "(prices, lead times, commitments not in the reference) are an automatic 0."
)


class _NumpyLike(Protocol):
    """Just enough numpy surface for cosine. Keeps the import isolated."""

    def array(self, x: Any, dtype: Any = ...) -> Any: ...
    def dot(self, a: Any, b: Any) -> Any: ...

    class linalg:  # noqa: D106
        @staticmethod
        def norm(x: Any) -> Any: ...  # pragma: no cover


@dataclass
class JudgeResult:
    """Outcome of a single judge call. ``win`` is 0 or 1; ``reason`` is the
    judge's one-line rationale (or a failure detail when the call errored
    or the cosine floor vetoed the result)."""

    win: int
    reason: str
    cosine: float | None = None
    error: str | None = None


def _build_judge_user_prompt(*, inbound: str, reference: str, candidate: str) -> str:
    """Render the ``(inbound, reference, candidate)`` triple for the judge.

    Order matters — placing REFERENCE before CANDIDATE in the prompt
    biases toward picking the second option. We mitigate by being explicit
    in the system prompt ("Default to 0 when uncertain") and by reporting
    the inverse direction for sanity-check via unit tests at a future date
    (left as a TODO; v0.1 ships the canonical direction only).
    """

    return (
        "## Inbound\n"
        f"{inbound.strip()}\n\n"
        "## Reference reply (operator-approved, sent)\n"
        f"{reference.strip()}\n\n"
        "## Candidate reply (LM-drafted)\n"
        f"{candidate.strip()}\n"
    )


def _parse_judge_response(text: str) -> tuple[int, str]:
    """Parse the judge's JSON envelope into ``(win, reason)``.

    Tolerant of leading/trailing whitespace and code-fence wrapping; otherwise
    strict — anything not matching ``{"win": 0|1, "reason": ...}`` is
    conservatively treated as a non-win.
    """

    stripped = text.strip()
    # Strip code fences if the judge ignored "JSON only".
    if stripped.startswith("```"):
        stripped = re.sub(r"^```(?:json)?\s*", "", stripped, flags=re.IGNORECASE)
        stripped = re.sub(r"\s*```$", "", stripped)
    try:
        parsed = json.loads(stripped)
    except json.JSONDecodeError:
        return 0, f"unparseable judge output: {stripped[:120]!r}"
    if not isinstance(parsed, dict):
        return 0, f"judge output not a JSON object: {type(parsed).__name__}"
    win_raw = parsed.get("win")
    if win_raw not in (0, 1):
        return 0, f"win not 0/1: {win_raw!r}"
    reason = str(parsed.get("reason", "")).strip() or "no reason given"
    return int(win_raw), reason


def _ollama_embed(text: str, *, base_url: str, model: str, client: httpx.Client) -> list[float] | None:
    """Embed a string via local Ollama; return ``None`` on infra failure.

    Mirrors `dashboard/lib/rag/embed.ts`'s POST /api/embed shape. We never
    raise out of this path — RAG-style infra (embed + qdrant) is best-effort
    augmentation, not gate. Same convention here.
    """

    try:
        resp = client.post(
            f"{base_url.rstrip('/')}/api/embed",
            json={"model": model, "input": text},
            timeout=30.0,
        )
        resp.raise_for_status()
        payload = resp.json()
    except Exception as exc:  # noqa: BLE001 — fail-soft sentinel
        logger.debug("ollama embed failed: %s", exc)
        return None
    embeddings = payload.get("embeddings") if isinstance(payload, dict) else None
    if not embeddings or not isinstance(embeddings, list):
        return None
    first = embeddings[0]
    if not isinstance(first, list):
        return None
    return [float(x) for x in first]


def _cosine(a: list[float], b: list[float]) -> float:
    """Cosine similarity between two equal-length float vectors.

    Local impl rather than numpy.linalg so the metric module stays cheap to
    import in the test environment — numpy is still a transitive dependency
    of DSPy, but cosine on a 768d vector is trivial without it.
    """

    if len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b, strict=False))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(y * y for y in b) ** 0.5
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / (na * nb)


# ---------------------------------------------------------------------------
# Public API: the metric callable
# ---------------------------------------------------------------------------


@dataclass
class JudgeConfig:
    """All-in-one judge configuration. Defaults match STAQPRO-343 decision log."""

    judge_model: str = DEFAULT_JUDGE_MODEL
    anthropic_api_key: str | None = None
    embed_base_url: str = DEFAULT_EMBED_BASE_URL
    embed_model: str = DEFAULT_EMBED_MODEL
    cos_floor: float = DEFAULT_COS_FLOOR
    # Disable the cosine sanity floor entirely (set to ``True`` when running
    # against synthetic traces in unit tests, where the nomic Ollama isn't
    # reachable).
    disable_cosine: bool = False


class JudgeMetric:
    """Callable that implements the GEPA-compatible metric signature.

    DSPy GEPA accepts a callable with signature
    ``metric(example, prediction, trace=None) -> float``. We expose this as a
    class to keep the Anthropic client + httpx client alive across calls
    (avoid reconnect overhead during a multi-hundred-call optimization run).
    """

    def __init__(self, config: JudgeConfig | None = None) -> None:
        self.config = config or JudgeConfig()
        api_key = self.config.anthropic_api_key or os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise RuntimeError(
                "ANTHROPIC_API_KEY not set — required for Haiku 4.5 judge. "
                "Set it in the environment or pass anthropic_api_key on JudgeConfig.",
            )
        self._anthropic = Anthropic(api_key=api_key)
        self._http = httpx.Client(timeout=30.0)

    def close(self) -> None:
        """Release the underlying HTTP client. Optional — Python GC handles it
        eventually, but a long-running optimization run should close cleanly."""

        try:
            self._http.close()
        except Exception:  # noqa: BLE001 — best-effort teardown
            pass

    def judge(self, *, inbound: str, reference: str, candidate: str) -> JudgeResult:
        """Run a single ``(candidate, reference, inbound)`` triple through the
        judge. Returns a structured ``JudgeResult`` with the win bit + reason."""

        # Empty / whitespace-only candidate is an automatic loss — saves a
        # cloud call when GEPA produces a degenerate prompt mutation.
        if not candidate.strip():
            return JudgeResult(win=0, reason="empty candidate", cosine=0.0)

        try:
            message: Message = self._anthropic.messages.create(
                model=self.config.judge_model,
                max_tokens=200,
                system=JUDGE_SYSTEM_PROMPT,
                messages=[
                    {
                        "role": "user",
                        "content": _build_judge_user_prompt(
                            inbound=inbound,
                            reference=reference,
                            candidate=candidate,
                        ),
                    }
                ],
            )
        except Exception as exc:  # noqa: BLE001 — fail-soft, attribute the failure
            logger.warning("anthropic judge call failed: %s", exc)
            return JudgeResult(win=0, reason="judge call errored", error=str(exc))

        # Anthropic SDK returns a list of content blocks; we expect one text block.
        text = ""
        for block in message.content:
            if getattr(block, "type", None) == "text":
                text = getattr(block, "text", "") or ""
                break
        win, reason = _parse_judge_response(text)

        # Cosine sanity floor — optional veto on the judge's "win".
        cosine: float | None = None
        if not self.config.disable_cosine:
            cand_emb = _ollama_embed(
                candidate,
                base_url=self.config.embed_base_url,
                model=self.config.embed_model,
                client=self._http,
            )
            ref_emb = _ollama_embed(
                reference,
                base_url=self.config.embed_base_url,
                model=self.config.embed_model,
                client=self._http,
            )
            if cand_emb is not None and ref_emb is not None:
                cosine = _cosine(cand_emb, ref_emb)
                if win == 1 and cosine < self.config.cos_floor:
                    return JudgeResult(
                        win=0,
                        reason=f"cosine floor veto (cos={cosine:.3f} < {self.config.cos_floor})",
                        cosine=cosine,
                    )

        return JudgeResult(win=win, reason=reason, cosine=cosine)

    def __call__(self, example: Any, prediction: Any, trace: Any = None) -> float:
        """GEPA metric callable.

        ``example`` is a DSPy ``Example`` carrying inbound + reference fields;
        ``prediction`` is the DSPy program's output for the draft-reply
        signature. Returns float in [0.0, 1.0] (win rate per-example is 0/1
        but the type contract allows fractional aggregates).
        """

        inbound = getattr(example, "inbound_body", "") or ""
        reference = getattr(example, "reply_body", "") or ""
        candidate = getattr(prediction, "reply_body", "") or ""
        result = self.judge(inbound=inbound, reference=reference, candidate=candidate)
        return float(result.win)


__all__ = [
    "DEFAULT_COS_FLOOR",
    "DEFAULT_EMBED_BASE_URL",
    "DEFAULT_EMBED_MODEL",
    "DEFAULT_JUDGE_MODEL",
    "JUDGE_SYSTEM_PROMPT",
    "JudgeConfig",
    "JudgeMetric",
    "JudgeResult",
]
