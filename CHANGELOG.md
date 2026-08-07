# Changelog

All notable changes to oh-my-agentmemory are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added — initial scaffold
- Hexagonal architecture: `src/core/` (agent-agnostic) + `src/adapters/opencode/`
- Phase 1: `experimental.chat.system.transform` per-turn directive push
- Phase 2: `session.created` slot bootstrap with cwd-based project map
- Phase 3: `chat.message` KR/EN keyword detection
- Phase 4: `session.status(idle)` crystal suggestion when ≥3 actions done
- Phase 5: `file.edited` auto-lesson save from file history
- Slash commands: `/am-recall`, `/am-save`, `/am-bootstrap`, `/am-status`

### Upstream tracking
- Companion to `agentmemory@v0.9.28` `plugin/opencode/agentmemory-capture.ts`
- capture.ts remains the canonical observer plugin; this plugin is write-side only

## Migration notes

If upgrading from a single-plugin setup with agentmemory-capture.ts only:
- Keep agentmemory-capture.ts in `opencode.json plugin[]` (do NOT remove)
- Add `./plugins/oh-my-agentmemory/plugin.ts` as a second entry
- Both plugins register `experimental.chat.system.transform`; opencode runs them in
  sequence (push-only, no conflict)
