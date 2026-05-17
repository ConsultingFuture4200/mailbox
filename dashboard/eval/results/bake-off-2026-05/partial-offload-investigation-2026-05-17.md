# Nemotron Memory-Pressure Investigation — STAQPRO-342 follow-up

> **Run:** 2026-05-17 ~01:50 PDT
> **Hardware:** mailbox1 (Heron Labs production Jetson Orin Nano Super, 8 GB unified)
> **Image:** `local/llama-cpp:cuda-jetson-2026-05-16` (HEAD `4f13cb7`)
> **Model:** `NVIDIA-Nemotron3-Nano-4B-Q4_K_M.gguf`
> **Prod state during probes:** llama-cpp + ollama stopped for the ~5 min investigation window; both restored after.

## TL;DR

**All 5 memory-reduction configs loaded cleanly and served prompts.** Including the same `--n-gpu-layers 99` config that crashed 100% of v1-v4 sweeps. **The real culprit was llama.cpp HEAD's default compute-buffer sizes** (`--batch-size 2048 --ubatch-size 512`), not the model itself or the KV cache.

With `--batch-size 512 --ubatch-size 128`, Nemotron survives full GPU offload on Orin 8GB.

## Configs tested

All share `--ctx-size 2048 --cache-type-k q4_0 --cache-type-v q4_0 --flash-attn on`. Variable dimension is GPU offload + batch sizing.

| # | Config | -ngl | KV loc | Batch / ubatch | 3-prompt time | t/s rough | Verdict |
|---|---|---|---|---|---|---|---|
| A | all-GPU + tight batch | **99** | GPU | **512 / 128** | **3371 ms** | **~14** | ✅ optimal |
| B | all-GPU + KV on CPU | 99 | CPU | 512 / 128 | 8383 ms | ~6 | works, ~2.5× slower |
| C | partial offload | 32 | GPU | 512 / 128 | 8228 ms | ~6 | works, ~2.4× slower |
| D | aggressive partial | 16 | GPU | 512 / 128 | 16602 ms | ~3 | works, ~5× slower |
| E | CPU-only | 0 | CPU | 512 / 128 | 33011 ms | ~1.5 | works, ~10× slower |

## Why this changes the bake-off

The full bake-off (`docs/plan-staqpro-342-bakeoff-v0_1-2026-05-16.md`) used the prod compose's batch defaults (effectively llama.cpp's defaults: 2048/512). That caused six kernel OOM-kills across v1-v4 and blocked all data collection on C1 + C2.

**With config A as the new baseline, a re-sweep of C1 + C2 should complete clean 100-trace runs** at full GPU performance. The bake-off's strategic question — Mamba/PLE/SFT2026 vs Qwen3 baseline — becomes answerable.

## Recommended re-run config

For the C1 + C2 re-sweep:
```
docker run --rm --runtime nvidia \
  -v .../llama-cpp-models:/models:ro -p 8080:8080 \
  --entrypoint /usr/local/bin/llama-server \
  local/llama-cpp:cuda-jetson-2026-05-16 \
  --model /models/<candidate>.gguf \
  --ctx-size 2048 --flash-attn on \
  --cache-type-k q4_0 --cache-type-v q4_0 \
  --batch-size 512 --ubatch-size 128 \
  --n-gpu-layers 99 \
  --host 0.0.0.0 --port 8080
```

Two methodology notes:
- The bake-off-harness already passes `--num-predict 256`; keep that.
- `--ctx-size 2048` (vs prod's 4096) means traces with inbox bodies > 2K tokens will get truncated by llama.cpp. Most of M1's v1.1 traces fit, but worst-case traces will fail. Acceptable for fair comparison since all candidates would hit the same cap.

## Why the prod compose has been stable on the OLD binary

Prod runs `local/llama-cpp:cuda-jetson` (= dustynv `b5283`, May 2025). That binary's default batch sizes are smaller than HEAD's, and its compute-buffer allocator is leaner. Same args (`-b` / `-ub` unspecified) = different memory profile. **Worth tracking upstream as a regression-vs-mitigation story**: HEAD made flash-attn more accurate but raised the default working-set size in ways that hit small-RAM systems.

## What this does NOT settle

- Function-call validity, blind-pref quality, real bake-off ranking for C1 + C2 — needs the re-sweep with config A
- Whether config A's tighter batches change per-token quality (theoretically shouldn't; batch size affects only throughput / parallelism, not the decoded distribution)
- Whether C3 Gemma 4 E4B would also unblock under config A — its OOM was at compute-graph reserve, similar pattern; worth one probe but not in this investigation's scope

## Provenance

Investigation log raw output: `mailbox1:/tmp/nemotron-offload-experiment.log` (operator-side, not committed). Distilled findings in this doc.

Branch `dustin/staqpro-342`, expected commit alongside this doc.

## Open question

The 14 t/s for Nemotron at config A is **below** the DR-21 gate's `≥ 15 t/s` requirement. This is from a 3-prompt micro-smoke, not a 100-trace run, so the average may shift either way. The bake-off's real-trace numbers will be definitive — Ctrl-A measured 16.0 t/s and Ctrl-B 15.4 t/s on the v2 100-trace run, so 14 t/s on 3 prompts maps roughly to Nemotron underperforming by ~10% on throughput. If confirmed at scale, gate 3 (≥15 t/s) becomes a real question for Nemotron even after the OOM is solved.
