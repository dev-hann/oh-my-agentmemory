# Changelog

All notable changes to oh-my-agentmemory are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added — observation compaction
- On `session.idle`, scores the session's observations with a local
  [jevos](https://github.com/feder-cr/jev) decision model (Jev-compatible
  System One server) and writes a preserved-set / drop-candidates report to
  `~/.local/share/oh-am/compaction/<sessionId>.json`
- Verdict rule `keep_call >= 0.35 OR importance >= 2`, calibrated on a
  106-observation hand-labeled corpus and re-validated by full LLM
  cross-judgment of 3,274 observations across 26 sessions:
  **false-drop 0** (all 81 jev drops confirmed as lifecycle-hook noise)
- Per-observation scoring is a single `noul` question (~0.2 s each,
  4 in parallel); scoring errors default to keep, and an unreachable jevos
  skips compaction entirely so the existing pipeline is unaffected
- Config: `"compaction": { "enabled": false, ... }` in oh-am.jsonc
  (see README "Observation compaction"); one-shot enable via
  `OH_AM_COMPACTION=1`

### Added — compaction v2: deletion execution
- Two-layer filter: layer 1 drops structural noise without calling jev —
  empty observations (age-gated by a 5-minute enrichment grace so raw
  observations awaiting server enrichment are never mistaken for noise)
  and lifecycle telemetry types (`config_loaded`, `llm_params`,
  `step_finish`); layer 2 is the jev verdict above. Benchmark showed ~85%
  of noise is structural
- Drop verdicts are deleted for real via the audit-logged agentmemory
  forget route (`POST /agentmemory/forget`); the report is stamped with
  `deletedAt` and the session summary is regenerated so it no longer
  references deleted noise
- Dropped verdicts carry a content snapshot (title + ~500-char excerpt)
  for post-deletion audit and manual re-ingest; guarded
  (`importance >= 2`) verdicts are never deleted; failed deletes retry on
  the next run
- Stale session GC now runs the same compaction pipeline for stale
  sessions the idle hook missed (skips sessions with an existing report),
  so historical noise cleans itself up over time
- Controls: `"delete": false` for shadow mode (reports only), env
  `OH_AM_COMPACTION_DELETE=off|on` overrides the config
- Benchmark tooling: `scripts/benchmark-backfill.ts` (backfill scoring +
  content export), `scripts/benchmark-compare.ts` (jev vs LLM-verdict
  agreement report), `scripts/e2e-compaction-check.ts` (live end-to-end
  verification)

## [0.2.0] - 2026-09-18

### Added — stale session GC
- One-shot sweep on plugin boot ends agentmemory sessions that have sat
  `active` with no updates for longer than `sessionGc.maxAgeDays`
  (default 7, disabled by default) — agentmemory-side only; opencode chat
  sessions on disk are never touched
- Reactivation guard: a prompt landing on an ended session (user resumed
  an old conversation) automatically restarts its agentmemory record
- TUI toast reports the ended session count after the sweep (via the
  opencode SDK `client.tui.showToast`; skipped silently in headless runs)
- Config: `"sessionGc": { "enabled": true, "maxAgeDays": 7 }` in oh-am.jsonc
- New client functions: `listSessions` / `endSession` / `restartSession`

### Added — npm publish via OIDC trusted publishing
- Tag-triggered GitHub Actions workflow (`publish.yml`) publishes to npm
  using OIDC trusted publishing — no long-lived npm token required,
  provenance attestation generated automatically

## [0.1.0] - 2026-09-06

### Added — npm distribution + CI
- Published to npm as `oh-my-agentmemory`; register with
  `"plugin": ["oh-my-agentmemory"]` (opencode auto-installs at startup)
- GitHub Actions CI: `bun install` + `typecheck` + `vitest` on push/PR
- README (EN/KO) install sections rewritten to npm flow; symlink method
  moved to a development details block
- Hooks count badge corrected to 6 (bridge/todo.updated was missing)

### Added — initial scaffold
- Hexagonal architecture: `src/core/` (agent-agnostic) + `src/adapters/opencode/`
- enforcement: `experimental.chat.system.transform` per-turn directive push
- init: `session.created` slot bootstrap with cwd-based project map
- intent: `chat.message` KR/EN keyword detection
- archive: `session.status(idle)` crystal suggestion when ≥3 actions done
- learning: `file.edited` auto-lesson save from file history
- Slash commands: `/am-recall`, `/am-save`, `/am-bootstrap`, `/am-status`

### Renamed — purpose-based identifiers
The five hooks were originally numbered `phase1` … `phase5`. Renamed to
purpose names so `OH_AM_DISABLE=<name>` reads as intent rather than order:

| Old | New |
|---|---|
| `phase1` | `enforcement` |
| `phase2` | `init` |
| `phase3` | `intent` |
| `phase4` | `archive` |
| `phase5` | `learning` |

**Breaking:** `OH_AM_DISABLE=phase3` (and any `phaseN` value) is silently
ignored. If you previously used phase numbers, migrate to the new names.

### Added — config file support
- New: `~/.config/opencode/oh-am.jsonc` (JSONC, comments allowed)
- Fields: `url`, `secret`, `mode`, `disabled`, `mcpOnly`, `profiles`,
  `activeProfile`, `projectMap`, `projectMapMode`, `policy`, `healthCheck*`,
  `debug`
- Precedence: env var > config file > built-in default
- New env vars: `OH_AM_MODE` (`auto` | `full` | `mcp-only`)
- New: `examples/oh-am.full.jsonc` complete reference

### Added — MCP-only mode branching
- `mode: "mcp-only"` (or auto-detect) skips `learning` and `archive` hooks
  (their data sources are empty without capture.ts)
- `enforcement` directive gains a stronger banner when in mcp-only mode
  (`mcpOnly.strengthenDirective`, default true)
- `intent` hook can auto-call `memory_save` on keyword matches when
  `mcpOnly.autoSaveOnKeyword: true` (default false)
- Auto-detection: probes agentmemory server, switches to mcp-only when
  recent sessions average <5 observations

### Added — health check on init
- `GET ${url}/agentmemory/health` on plugin load
- `healthCheckFatal: true` self-disables the plugin on failure

### Upstream tracking
- Companion to `agentmemory@v0.9.28` `plugin/opencode/agentmemory-capture.ts`
- capture.ts remains the canonical observer plugin; this plugin is write-side only

## Migration notes

If upgrading from a single-plugin setup with agentmemory-capture.ts only:
- Keep agentmemory-capture.ts in `opencode.json plugin[]` (do NOT remove)
- Add `./plugins/oh-my-agentmemory/plugin.ts` as a second entry
- Both plugins register `experimental.chat.system.transform`; opencode runs them in
  sequence (push-only, no conflict)
