# oh-my-agentmemory

opencode plugin that makes your agent use [agentmemory](https://github.com/rohitg00/agentmemory) proactively.

Companion to `agentmemory-capture.ts` (which passively observes opencode events). This plugin handles the **write side** — forcing the LLM to call memory tools, filling empty slots, detecting keywords, suggesting crystals, and auto-saving lessons from file edit history.

## Why

agentmemory ships 54 MCP tools and 22 capture hooks. Capture works great (50+ sessions auto-recorded). But the agent rarely calls `memory_save`, `memory_slot_replace`, `memory_lesson_save`, or `memory_crystallize` on its own. Empty slots, zero crystals, near-zero lessons — the write side stalls.

This plugin fixes that with five hooks:

| Phase | Hook | Effect |
|---|---|---|
| 1 | `experimental.chat.system.transform` | Per-turn directive push (policy summary + state flags) |
| 2 | `event: session.created` | Bootstrap empty pinned slots from cwd-based project map |
| 3 | `chat.message` | Detect "remember" / "기억해" / "forget" keywords → directive reinforcement |
| 4 | `event: session.status(idle)` | Suggest `memory_crystallize` when ≥3 actions done |
| 5 | `event: file.edited` | Auto-save lesson when file history shows repeated bug patterns |

## Architecture

Hexagonal (ports & adapters) to keep cross-agent portability cheap.

```
src/
├── core/                  # agent-agnostic pure TS (no I/O, easily tested)
│   ├── directives.ts      # buildDirective(ctx) → string
│   ├── bootstrap.ts       # slot templates + detectProject(cwd)
│   ├── keywords.ts        # KR/EN patterns
│   ├── lessons.ts         # buildLessonFromFileHistory() → LessonCandidate
│   ├── policy.ts          # rules/memory.md encoded as data
│   └── types.ts
└── adapters/
    └── opencode/          # current; claude-code/codex later
        ├── plugin.ts      # single entry, registers all hooks
        ├── client.ts      # agentmemory HTTP wrapper
        ├── hooks/
        └── commands/      # /am-recall, /am-save, /am-bootstrap, /am-status
```

Future agents (claude-code, codex) reuse `core/` as-is — only the adapter dir changes.

## Install (local dev)

```bash
# 1. clone
git clone git@github.com:dev-hann/oh-my-agentmemory.git ~/Documents/oh-my-agentmemory
cd ~/Documents/oh-my-agentmemory
bun install

# 2. symlink into opencode plugins
ln -s ~/Documents/oh-my-agentmemory/src/adapters/opencode \
      ~/.config/opencode/plugins/oh-my-agentmemory

# 3. register in opencode.json plugin[]
# (see below)

# 4. restart opencode
```

`opencode.json` diff:

```json
{
  "plugin": [
    "./plugins/agentmemory-capture.ts",
    "./plugins/oh-my-agentmemory/plugin.ts"
  ]
}
```

## Configuration

Optional env vars (read by adapter):

| Var | Default | Effect |
|---|---|---|
| `AGENTMEMORY_URL` | `http://localhost:3111` | agentmemory server base URL |
| `AGENTMEMORY_SECRET` | `""` | bearer token if auth enabled |
| `OH_AM_DEBUG` | `0` | verbose stderr logging |
| `OH_AM_DISABLE` | comma-list | e.g. `phase5,phase4` to disable specific hooks |

## Slash commands

| Command | Action |
|---|---|
| `/am-recall <query>` | Search past observations + lessons |
| `/am-save <text>` | Save an insight to long-term memory |
| `/am-bootstrap` | Force slot re-bootstrap now |
| `/am-status` | Show slot fill state + recent memory/lesson counts |

## Requirements

- agentmemory server running (`npx @agentmemory/agentmemory`)
- opencode 1.14+ (for `experimental.chat.system.transform` hook)
- Bun (for plugin runtime + dev tooling)

## License

MIT
