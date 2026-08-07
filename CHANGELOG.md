# Changelog

All notable changes to oh-my-agentmemory are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
