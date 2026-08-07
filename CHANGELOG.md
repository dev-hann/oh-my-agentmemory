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

### Upstream tracking
- Companion to `agentmemory@v0.9.28` `plugin/opencode/agentmemory-capture.ts`
- capture.ts remains the canonical observer plugin; this plugin is write-side only

## Migration notes

If upgrading from a single-plugin setup with agentmemory-capture.ts only:
- Keep agentmemory-capture.ts in `opencode.json plugin[]` (do NOT remove)
- Add `./plugins/oh-my-agentmemory/plugin.ts` as a second entry
- Both plugins register `experimental.chat.system.transform`; opencode runs them in
  sequence (push-only, no conflict)
