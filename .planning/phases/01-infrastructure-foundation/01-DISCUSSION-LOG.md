# Phase 1: Infrastructure Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-02
**Phase:** 01-infrastructure-foundation
**Areas discussed:** First-boot automation, Docker Compose structure, LUKS encryption setup, Dev workflow

---

## First-boot Automation

### Q1: How automated should the Jetson first-boot setup be?

| Option | Description | Selected |
|--------|-------------|----------|
| Full setup script | Single bash script: installs Docker via JetsonHacks, configures NVIDIA runtime, sets MAXN power mode, pulls all images, runs docker compose up. Best for reproducing across 5 units. | |
| Checkpoint script | Script broken into stages with manual verification between each. Slower but safer for first-time hardware bring-up. | ✓ |
| Manual runbook | Step-by-step commands in a markdown doc. Maximum visibility but tedious to repeat. | |

**User's choice:** Checkpoint script
**Notes:** None

### Q2: What should happen when a checkpoint fails?

| Option | Description | Selected |
|--------|-------------|----------|
| Stop and print fix | Script halts with clear error message and suggested fix command. | |
| Auto-retry then stop | Script retries failed step once, then stops with diagnostics if retry fails. | ✓ |
| You decide | Claude picks the best error handling per checkpoint. | |

**User's choice:** Auto-retry then stop
**Notes:** None

### Q3: Should the script handle JetPack version detection?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, validate at start | Script checks /etc/nv_tegra_release for r36.4+ and warns/aborts if wrong JetPack version. | ✓ |
| No, assume correct | Skip version checks to stay simpler. | |
| You decide | Claude determines what version checks are worth including. | |

**User's choice:** Yes, validate at start
**Notes:** None

---

## Docker Compose Structure

### Q1: How should services handle restarts and boot ordering?

| Option | Description | Selected |
|--------|-------------|----------|
| Strict depends_on + healthchecks | Postgres first, then Qdrant + Ollama, then n8n, then Dashboard. restart: unless-stopped. | ✓ |
| Loose ordering, all restart: always | Let Docker restart failed services until they connect. Simpler but noisier. | |
| You decide | Claude picks the right strategy per service. | |

**User's choice:** Strict depends_on + healthchecks
**Notes:** None

### Q2: How should environment variables and secrets be managed?

| Option | Description | Selected |
|--------|-------------|----------|
| .env file | Single .env file at project root, gitignored. Contains API keys, passwords. | ✓ |
| Docker secrets | File-based secret mounting. More secure but adds complexity. | |
| Inline in compose | Hardcode non-sensitive defaults, override sensitive via .env. | |

**User's choice:** .env file
**Notes:** None

### Q3: Volume strategy for persistent data?

| Option | Description | Selected |
|--------|-------------|----------|
| Named volumes | Docker named volumes for Postgres, Qdrant, Ollama models. Standard approach. | ✓ |
| Bind mounts to /data | Mount host directories into containers. Easier to inspect on host. | |
| You decide | Claude picks per service. | |

**User's choice:** Named volumes
**Notes:** None

### Q4: Image pinning strategy?

| Option | Description | Selected |
|--------|-------------|----------|
| Version tags for now | Pin to version tags. Switch to digest pins in Phase 3. | ✓ |
| Digest pins from day one | Pin to sha256 digests immediately. Maximum reproducibility. | |
| You decide | Claude picks the right pinning strategy. | |

**User's choice:** Version tags for now
**Notes:** None

---

## LUKS Encryption Setup

### Q1: How should the NVMe encryption key be managed for unattended boot?

| Option | Description | Selected |
|--------|-------------|----------|
| TPM2 auto-unlock | Bind LUKS key to Jetson's TPM2 chip. Boots without passphrase. Data unreadable if NVMe removed. | ✓ |
| Passphrase at boot | Require passphrase via SSH/console on every cold boot. Not practical for appliance. | |
| Defer encryption to Phase 3 | Skip LUKS for now. Simplifies Phase 1 but leaves data unencrypted. | |
| You decide | Claude picks based on Jetson TPM availability. | |

**User's choice:** TPM2 auto-unlock
**Notes:** None

### Q2: When should LUKS encryption be applied?

| Option | Description | Selected |
|--------|-------------|----------|
| During first-boot script | Encrypt data partition after JetPack flash, before Docker setup. Adds ~10 min. | ✓ |
| Pre-flash, in NVMe prep | Encrypt before flashing JetPack. More manual setup. | |
| Post-setup, separate step | Run LUKS after everything works. Risk: data touches disk unencrypted briefly. | |

**User's choice:** During first-boot script
**Notes:** None

---

## Dev Workflow

### Q1: How will you primarily develop and deploy to the Jetson?

| Option | Description | Selected |
|--------|-------------|----------|
| SSH + local editor | SSH into Jetson, edit directly on-device. Simple, no cross-compile issues. | ✓ |
| VS Code Remote SSH | Full IDE over SSH. Heavier on Jetson (~200MB RAM). | |
| Desktop dev + deploy | Develop on desktop, push to git, pull on Jetson. Can't test GPU locally. | |
| You decide | Claude determines dev workflow artifacts per phase. | |

**User's choice:** SSH + local editor
**Notes:** None

### Q2: Should Phase 1 deliverables include a smoke test script?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, full smoke test | Script verifying all 5 success criteria. Reusable for 5-unit run. | ✓ |
| Manual verification checklist | Markdown checklist with commands. Simpler but tedious to repeat. | |
| You decide | Claude determines verification approach per criterion. | |

**User's choice:** Yes, full smoke test
**Notes:** None

### Q3: Where should compose files and scripts live in the repo?

| Option | Description | Selected |
|--------|-------------|----------|
| Project root | docker-compose.yml, .env.example, scripts/ at repo root. Flat structure. | ✓ |
| deploy/ directory | All infrastructure in deploy/ subdirectory. Keeps root clean. | |
| You decide | Claude picks the repo layout. | |

**User's choice:** Project root
**Notes:** None

---

## Claude's Discretion

- Error handling specifics per checkpoint stage
- Healthcheck intervals and timeout values
- Docker network configuration
- Ollama model pull strategy
- Smoke test output format

## Deferred Ideas

None — discussion stayed within phase scope.
