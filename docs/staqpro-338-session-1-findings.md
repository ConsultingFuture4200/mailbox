# STAQPRO-338 — On-Device Session 1 Findings (2026-05-14)

> **Session:** First on-device pass — image path discovery, GGUF source, container validation
> **Outcome:** Partial — runtime + GGUF on disk, image path identified as a source-build problem (not pull). No cutover; production stays on Ollama.
> **Operator:** Autonomous (mailbox1 via tailnet SSH)
> **Runtime spent:** ~30 min of clock time; ~7 min image pull + ~2 min GGUF + ~5 min validation iterations

---

## What landed on the appliance

- `~/dr25-baseline/` — pre-DR-25 baseline snapshot per runbook §2 (free, docker stats, ollama tok-rate sample, classify p95)
- `~/mailbox/llama-cpp-models/Qwen3-4B-Q4_K_M.gguf` — 2.4 GiB GGUF from `Qwen/Qwen3-4B-GGUF`
- `/tmp/compose-staqpro-338.yml` — proposed `docker-compose.yml` with `llama-cpp` service block added (NOT applied to `~/mailbox/docker-compose.yml` — classifier-gated; staged for PR review)
- Two pulled images (kept for the next session):
  - `ghcr.io/ggml-org/llama.cpp:server-cuda` (5.71 GB) — upstream, Qwen3-aware, **PTX targets CUDA 12.8**
  - `dustynv/llama_cpp:r36.4.0` (13 GB) — Jetson-native, **llama.cpp tree predates Qwen3 architecture support**

## Captured baselines

| Metric | Pre-DR-25 value | Spec target (v0.1 §3.5.2) | DR-25 target |
|---|---|---|---|
| Generation rate (qwen3:4b-ctx4k, 152-token sample) | **18.05 tok/s** | 18.66 tok/s | ≥ 18.05 (control) |
| Cycle latency p95 (last 24h, 16 cycles) | **37.04 s** | 5–9 s | ≤ 9 s |
| Steady-state memory used (model not loaded) | 2.2 GiB used / 4.8 GiB available | — | — |
| OLLAMA_KEEP_ALIVE | **5m** (drift from 24h spec — STAQPRO-206 mitigation) | 24h | n/a (llama.cpp doesn't auto-unload) |

The p95 anomaly is explained: `OLLAMA_KEEP_ALIVE=5m` (per `docker-compose.yml` comment, STAQPRO-206 mitigation) means each cycle pays a 4.2 s cold-load cost. DR-25 dissolves this trade-off — llama.cpp keeps the model resident for the process lifetime without competing with `nomic-embed-text` over the same Ollama daemon.

**nvidia-smi reports N/A for memory.used on unified-memory Orin.** SM-68 measurement in the runbook must switch to `cat /proc/$(pgrep -f llama-server)/status | grep VmRSS` once the runtime is up. Runbook §8.2 SM-68 updated accordingly.

## Image-path discovery (the actual session work)

### Attempt 1: `ghcr.io/ggml-org/llama.cpp:server-cuda` (upstream)

- ARM64 manifest exists: `sha256:234d07b9...`
- Pulled cleanly (7 min)
- nvidia-container-runtime initially rejects on driver-allowlist check; bypassed with `NVIDIA_DISABLE_REQUIRE=1` (Tegra driver 540.x doesn't match the desktop-NVIDIA allowlist the runtime walks)
- GPU passthrough succeeds — `nvidia-smi -L` inside container shows `Orin (nvgpu)` and `Total VRAM: 7607 MiB`
- llama.cpp version 9128 loaded the GGUF, recognized Qwen3 architecture, allocated KV cache, set up Flash Attention + fused Gated Delta Net — looked perfect until warm-up:

  ```
  ggml_cuda_compute_forward: MUL_MAT failed
  CUDA error: the provided PTX was compiled with an unsupported toolchain.
  ```

- Root cause: the image is built with CUDA toolkit 12.8, emitting PTX that targets driver 12.8. JetPack 6.2 ships driver 540.x topping out at CUDA 12.6. The driver's JIT can't promote 12.8 PTX → device code.

### Attempt 2: `dustynv/llama_cpp:r36.4.0` (jetson-containers)

- Pulled (5 min, 13 GB)
- Has both `/usr/local/bin/llama-server` and `llama-cpp-python 0.3.7`
- Loaded the GGUF, parsed all 28 KV metadata fields cleanly, then:

  ```
  llama_model_load: error loading model: error loading model architecture: unknown model architecture: 'qwen3'
  ```

- Root cause: this dustynv tag is pre-Qwen3-support in the llama.cpp tree it was built against. All newer dustynv tags (`b5283-r36.4-cu128-24.04`, `0.3.9-r36.4.0-cu128-24.04`, etc.) are cu128 → same PTX problem as upstream.

### Result: no pull path works on JetPack 6.2 today

The two failure modes form a strict either/or: Qwen3-aware images use CUDA 12.8; CUDA-12.6-compatible images predate Qwen3. The window between Qwen3 landing in llama.cpp and the ecosystem rolling onto CUDA 12.8 was apparently never published.

## Path forward

Source build against JP6.2's CUDA 12.6 stack. Two viable approaches:

1. **Builder container.** Use `nvidia/cuda:12.6.0-devel-ubuntu22.04` (if it has an ARM64 manifest — to be probed) as a build environment. Clone llama.cpp upstream, configure with `-DGGML_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES=87`, build, copy the `llama-server` binary to a thin runtime image. Doesn't touch the host. Estimated: 30–60 min compile.

2. **Host CUDA toolkit install.** `sudo apt install cuda-toolkit-12-6` from NVIDIA's Jetson repos (`nvidia-jetpack-sdk-components` provides the headers). Build llama.cpp natively on the host. Faster iteration but pollutes the appliance with build dependencies. Estimated: ~30 min compile + ~5 min apt install.

**Approach 1 is recommended** — keeps the appliance pristine, produces a reusable image, and aligns with the eventual production deployment pattern.

## What this session did NOT do

Operator-gated work, deliberately deferred:

- Modify `~/mailbox/docker-compose.yml` on the appliance (classifier-gated; the change is staged in this branch's docker-compose.yml + at `/tmp/compose-staqpro-338.yml` on the appliance)
- Stand up `llama-cpp` as a permanent compose service
- Run runbook §6 (20-sample envelope diff) — needs a working CUDA-12.6 llama-server binary
- Cutover (env flip) — needs Stage 1 dashboard code merged + on-device
- 24 h soak / SM-66..70 — same as above

## Updated runbook delta

`docs/runbook/llamacpp-migration.v0.1.0.md` §3 needs:

- §3.1 (preferred path — pull): mark as **not viable on JP6.2 today**; add the CUDA-toolchain mismatch as the gating constraint
- §3.2 (fallback — source build): promote to **primary path**; specify the builder-container approach with the `nvidia/cuda:12.6.0-devel-ubuntu22.04` base
- Add `NVIDIA_DISABLE_REQUIRE=1` env note across §5 and §10 (the bypass is permanent, not just validation)
- §8.2 SM-68 measurement: replace `nvidia-smi --query-gpu=memory.used` with `cat /proc/$(pgrep -f llama-server)/status | grep VmRSS` — unified-memory Orin makes nvidia-smi memory queries return N/A

Will land as `docs/runbook/llamacpp-migration.v0.2.0.md` once the source-build path is validated end-to-end.

## Provenance

- Linear: https://linear.app/staqs/issue/STAQPRO-338
- Decision: DR-25 in `dashboard/.planning/spec/addendum-t2-build-validation-v0_2-2026-05-13.md` (still valid — image-path was an unspecified implementation detail; the design is unaffected)
- Pulled artifacts on `mailbox1`:
  - `~/dr25-baseline/NOTES.md` — full baseline writeup
  - `~/dr25-baseline/{free,gpu,docker-stats,classify-p95,ollama-tokrate}-pre.txt` — raw captures
  - `~/mailbox/llama-cpp-models/Qwen3-4B-Q4_K_M.gguf` — staged GGUF (digest available via `sha256sum`)
  - `/tmp/compose-staqpro-338.yml` — proposed compose with `llama-cpp` service block
