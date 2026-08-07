# Contributing to oh-my-agentmemory

Thanks for your interest in improving this plugin. Before opening a PR,
please open an issue to discuss the scope — this keeps changes aligned
with the hexagonal architecture and avoids wasted work.

## Project layout

Read [`README.md#architecture`](./README.md#architecture) first. The
short version:

- `src/core/` — agent-agnostic pure TypeScript. No I/O, no `fetch`, no
  `process.env` reads in business logic. Every function here must be
  unit-testable without mocks.
- `src/adapters/opencode/` — opencode-specific glue. Reads env vars,
  talks to the agentmemory HTTP API, registers hooks. Core should never
  import from adapters.

If you find yourself importing adapter code from core, the boundary is
wrong. Move the logic to core as a pure function, or keep it in the
adapter.

## Development setup

```bash
git clone https://github.com/dev-hann/oh-my-agentmemory.git
cd oh-my-agentmemory
bun install
```

Required:

- Bun ≥ 1.1
- A running agentmemory server (`npx @agentmemory/agentmemory`) for adapter
  manual testing

## Workflow

1. Fork → feature branch (`feat/...`, `fix/...`, `docs/...`)
2. Add or update tests under `tests/core/` for any `core/` change
3. Run the full check locally:
   ```bash
   bun run typecheck
   bun run test
   ```
4. Keep commits focused — one logical change per commit, conventional
   commit messages (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`)
5. Open a PR against `main`. Reference the issue it closes.

## Adding a new hook

If you're adding a new hook behavior:

1. Implement the pure logic in `src/core/` (a new file or extension of
   an existing one)
2. Add unit tests in `tests/core/`
3. Wire the hook in `src/adapters/opencode/hooks/`
4. Register it in `src/adapters/opencode/plugin.ts`
5. Add a row to the hook table in both `README.md` and `README.ko.md`
6. Add a `OH_AM_DISABLE=<purpose>` knob by extending the `PhaseId` type and
   the parse function in each adapter hook
7. Update `CHANGELOG.md` under `[Unreleased]`

## Adding a new agent adapter

Future agents (claude-code, codex) should reuse `core/` unchanged. The
shape of an adapter is:

```
src/adapters/<agent>/
├── plugin.ts or hooks.json  # whatever the agent's plugin system expects
├── client.ts                # agent's I/O mechanism (HTTP / shell / IPC)
└── hooks/                   # one file per purpose
```

If you find yourself wanting to change `core/` to make an adapter work,
that's a smell — open an issue first.

## Style

- TypeScript strict mode. No `any` without justification in a comment.
- Pure functions over classes in `core/`.
- Adapters can be async, but extract the async boundary to the edge.
- Comments: explain *why*, not *what*. The code already says what.
- 100-char soft line limit.

## Updating the directive policy

`src/core/policy.ts` is the single source of truth for the rules pushed
into the system prompt. When editing:

- Keep each rule short (one imperative sentence)
- Test that `buildDirective()` still produces sensible output
- Update both `README.md` and `README.ko.md` sample directive blocks if
  the rules change shape

## Releasing

Releases are currently manual (no npm publish yet). When that changes,
this section will describe the version bump + tag + publish flow.

## License

By contributing, you agree your contributions are licensed under the
[MIT license](./LICENSE).
