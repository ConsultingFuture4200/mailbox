# Phase 2 Status — STAQPRO-342 GGUF Retrieval

> **Status:** 4/5 candidates on M1. Nemotron blocked on HF user-level auth.
> **Updated:** 2026-05-16 18:54 PDT
> **Models dir on M1:** `/home/bob/mailbox/llama-cpp-models/` (bind-mounted read-only into `mailbox-llama-cpp-1`)

## Candidates state

| # | Candidate | Repo | File | Size | SHA-256 (16) | State |
|---|---|---|---|---|---|---|
| Ctrl-A | `qwen3:4b-ctx4k` (baseline) | (custom-built, pre-existing) | `qwen3-4b-ctx4k.gguf` | 2.33 GB | `7485fe6f11af2943` | ✅ on M1 (live prod) |
| Ctrl-B | Qwen3-4B-Instruct-2507 | `unsloth/Qwen3-4B-Instruct-2507-GGUF` | `Qwen3-4B-Instruct-2507-Q4_K_M.gguf` | 2.33 GB | `3605803b982cb64a` | ✅ on M1 |
| C2 | Qwen3.5-4B | `unsloth/Qwen3.5-4B-GGUF` | `Qwen3.5-4B-Q4_K_M.gguf` | 2.55 GB | `00fe7986ff5f6b46` | ✅ on M1 |
| C3 | Gemma 4 E4B | `unsloth/gemma-4-E4B-it-GGUF` | `gemma-4-E4B-it-Q4_K_M.gguf` | 4.64 GB | `519b9793ed6ce0ff` | ✅ on M1 — but **size > §3.5 envelope** |
| C1 | NVIDIA Nemotron 3 Nano 4B | `nvidia/NVIDIA-Nemotron-3-Nano-4B-GGUF` | _TBD_ | _TBD_ | _TBD_ | ⛔ **BLOCKED on HF token + click-through** |

## License posture

All four pulled candidates: **Apache 2.0** (confirmed via HF model card `license` field). No attribution work needed.

Nemotron: license cleared at the org level per STAQPRO-339 memo v0.2 (counsel sign-off 2026-05-14, attribution staged at `licenses/NVIDIA-Nemotron-Open-Model-License.txt` + `NOTICE`). But HF's per-user gating still applies — Dustin's HF account must click-through-accept on the model card before a download token works.

## Nemotron unblock options

1. **Provide HF token in chat** (`hf_...`) — Dustin's HF account with click-through accepted. I write it to `~/.cache/huggingface/token` on M1 (mode 600), pull Nemotron, then remove the token. Token never enters the repo.
2. **Dustin SSHs to M1 and pulls manually**:
   ```bash
   ssh mailbox1
   ~/.local/bin/hf auth login              # browser flow, paste token
   ~/.local/bin/hf download nvidia/NVIDIA-Nemotron-3-Nano-4B-GGUF \
     <filename>.gguf --local-dir /home/bob/mailbox/llama-cpp-models
   ```
   (Will need to inspect repo to find the exact Q4_K_M filename — Nemotron's GGUF release naming is non-obvious.)
3. **Skip Nemotron for now** — run 4-way bake-off (Ctrl-A, Ctrl-B, C2, C3). Still meaningful comparison, just loses the Mamba-architecture data point. Noted in the eventual addendum v0.2.

## §3.5 envelope flag — Gemma 4 E4B is heavier than predicted

- Plan/issue predicted Gemma 4 E4B at **~3.0 GB memory footprint** (E4B PLE architecture claim).
- Actual GGUF file is **4.64 GB** at Q4_K_M. Disk size doesn't always equal VRAM (PLE is selective at runtime), but this is a 55% larger disk footprint than predicted.
- **Risk:** at runtime, Gemma 4 E4B may push the §3.5 envelope (≤3.4 GiB at 4K context). Will be confirmed in the Phase 2 load-verify step (deferred — needs prod GPU swap).
- **Mitigation:** if Gemma exceeds envelope at load time, drop C3 to 4-way (or 3-way if Nemotron also drops).

## What's NOT done in Phase 2 yet

Per the plan's Phase 2 deliverables, still pending:
- **Load-verify each candidate** — for each GGUF, stop prod llama.cpp, boot the candidate, confirm `nvidia-smi` reports <7.5 GiB resident, run a smoke prompt, shut down. ~3 min per candidate × 4 ≈ 12 min of prod downtime.
- **Schedule:** SLO carve-out window 02:00-05:00 PT (per plan v0.1.1 `6f7fbbc`), OR with explicit "go load-verify now" go-ahead.

## File paths for Phase 3

The bake-off sweep CLI will invoke each candidate via:

```bash
# On M1, for each candidate:
docker compose stop llama-cpp
# Edit docker-compose.yml `--model` path → candidate GGUF
docker compose up -d llama-cpp
# Run harness from operator workstation:
npx tsx dashboard/scripts/bake-off-harness.ts \
  --model <candidate-tag> \
  --base-url http://192.168.50.179:8080 \
  --trace-set dashboard/eval/t2-traces/v1.1 \
  --run-tag eval-<candidate-tag>-2026-05-XX \
  --out dashboard/eval/results/bake-off-2026-05 \
  --quantization Q4_K_M \
  --context-length 4096 \
  --runtime-sha <llamacpp git sha> \
  --gguf-sha256 <SHA from table above>
# Restore prod:
# Edit docker-compose.yml `--model` back to qwen3-4b-ctx4k.gguf
docker compose up -d llama-cpp
```

## Disk impact

```
M1 NVMe: 937 GB total
Before Phase 2: 123 GB used (14%)
After Phase 2: 133 GB used (15%)  ← +10 GB for 3 new GGUFs
After Nemotron: ~136 GB used (15%) (estimate, +3 GB)
```

Well within budget. NVMe wear is one-time write of ~13 GB.
