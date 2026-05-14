"""Tests for ``metric.JudgeMetric``.

Coverage:
* Judge response parsing: well-formed JSON → ``(1, reason)``, malformed →
  ``(0, ...)`` conservative fallback, code-fence wrapping tolerated.
* Cosine math: identical vectors → 1.0, orthogonal → 0.0, mismatched
  length → 0.0.
* Empty candidate → automatic loss, judge not called.
* Mocked Anthropic happy path: judge returns ``win=1``, cosine disabled,
  ``__call__`` returns ``1.0``.

All Anthropic + Ollama calls are mocked. No live cloud or local-network
calls happen in CI.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from metric import (
    JudgeConfig,
    JudgeMetric,
    JudgeResult,
    _cosine,
    _parse_judge_response,
)


# ---------------------------------------------------------------------------
# Pure helpers — no env / cloud
# ---------------------------------------------------------------------------


def test_parse_judge_response_well_formed_win() -> None:
    win, reason = _parse_judge_response('{"win": 1, "reason": "matches intent"}')
    assert win == 1
    assert reason == "matches intent"


def test_parse_judge_response_well_formed_loss() -> None:
    win, reason = _parse_judge_response('{"win": 0, "reason": "tone off"}')
    assert win == 0
    assert reason == "tone off"


def test_parse_judge_response_strips_code_fence() -> None:
    raw = '```json\n{"win": 1, "reason": "ok"}\n```'
    win, reason = _parse_judge_response(raw)
    assert win == 1
    assert reason == "ok"


def test_parse_judge_response_unparseable_is_loss() -> None:
    win, reason = _parse_judge_response("absolutely not JSON")
    assert win == 0
    assert "unparseable" in reason


def test_parse_judge_response_non_bool_win_is_loss() -> None:
    win, reason = _parse_judge_response('{"win": "yes", "reason": "..."}')
    assert win == 0
    assert "win not 0/1" in reason


def test_parse_judge_response_non_object_is_loss() -> None:
    win, reason = _parse_judge_response("[1, 2, 3]")
    assert win == 0
    assert "not a JSON object" in reason


def test_cosine_identical_is_one() -> None:
    assert _cosine([1.0, 2.0, 3.0], [1.0, 2.0, 3.0]) == pytest.approx(1.0)


def test_cosine_orthogonal_is_zero() -> None:
    assert _cosine([1.0, 0.0], [0.0, 1.0]) == pytest.approx(0.0)


def test_cosine_length_mismatch_is_zero() -> None:
    assert _cosine([1.0], [1.0, 1.0]) == 0.0


def test_cosine_zero_vector_is_zero() -> None:
    assert _cosine([0.0, 0.0], [1.0, 1.0]) == 0.0


# ---------------------------------------------------------------------------
# Mocked end-to-end
# ---------------------------------------------------------------------------


def _build_mock_metric(monkeypatch: pytest.MonkeyPatch) -> JudgeMetric:
    """Construct a ``JudgeMetric`` without touching real Anthropic.

    Patches ``metric.Anthropic`` at the class level so the constructor
    doesn't try to validate an API key, and forces ``disable_cosine=True``
    so we don't touch Ollama.
    """

    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test-key")
    with patch("metric.Anthropic") as mock_cls:
        mock_cls.return_value = MagicMock()
        return JudgeMetric(JudgeConfig(disable_cosine=True))


def test_empty_candidate_is_automatic_loss(monkeypatch: pytest.MonkeyPatch) -> None:
    metric = _build_mock_metric(monkeypatch)
    try:
        result = metric.judge(inbound="hi", reference="hello", candidate="   ")
        assert isinstance(result, JudgeResult)
        assert result.win == 0
        assert result.reason == "empty candidate"
        # And the Anthropic mock was never called.
        assert metric._anthropic.messages.create.called is False  # noqa: SLF001
    finally:
        metric.close()


def test_judge_happy_path_returns_win(monkeypatch: pytest.MonkeyPatch) -> None:
    metric = _build_mock_metric(monkeypatch)
    try:
        # Anthropic SDK returns Message-like object with .content list of
        # blocks; each block has .type and .text.
        text_block = SimpleNamespace(type="text", text='{"win": 1, "reason": "matches intent"}')
        fake_msg = SimpleNamespace(content=[text_block])
        metric._anthropic.messages.create.return_value = fake_msg  # noqa: SLF001

        score = metric(
            SimpleNamespace(inbound_body="hi", reply_body="reference reply"),
            SimpleNamespace(reply_body="candidate reply"),
        )
        assert score == 1.0
        assert metric._anthropic.messages.create.called is True  # noqa: SLF001
    finally:
        metric.close()


def test_judge_anthropic_error_is_loss(monkeypatch: pytest.MonkeyPatch) -> None:
    metric = _build_mock_metric(monkeypatch)
    try:
        metric._anthropic.messages.create.side_effect = RuntimeError("503 overloaded")  # noqa: SLF001
        result = metric.judge(inbound="hi", reference="ref", candidate="cand")
        assert result.win == 0
        assert "errored" in result.reason
        assert "503" in (result.error or "")
    finally:
        metric.close()


def test_judge_missing_api_key_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="ANTHROPIC_API_KEY"):
        JudgeMetric(JudgeConfig(disable_cosine=True))
