# opencode Discord — #showcase

**Hey 👋 just released oh-my-agentmemory — a plugin that makes your agent actually WRITE to memory, not just read from it.**

If you run [agentmemory](https://github.com/rohitg00/agentmemory) alongside opencode, you've probably noticed the same thing I did: capture works great, but the agent almost never calls `memory_save` on its own. Pinned slots sit empty. "Remember this" gets an "ok" and nothing is saved. Rules files get ignored.

So this plugin turns memory hygiene into a **per-turn directive** the model literally cannot miss (via `experimental.chat.system.transform`):

- **enforcement** — policy banner injected every LLM turn
- **init** — auto-fills empty pinned slots (persona, project_context, …) on session start
- **intent** — bilingual keyword detection: "remember" / "기억해" → queued for the next directive
- **learning** — auto-saves lessons when file edits show error signals
- **archive** — suggests `memory_crystallize` when done actions pile up
- **bridge** — high-priority todos → agentmemory actions

Install is one line in `opencode.json`:

```json
{ "plugin": ["oh-my-agentmemory"] }
```

Keep `agentmemory-capture.ts` alongside it — this one is write-side only.

Been running it daily for about a month — the difference is night and day. 72 tests, MIT, docs in EN + 한국어.

GitHub: https://github.com/dev-hann/oh-my-agentmemory
npm: https://www.npmjs.com/package/oh-my-agentmemory

Happy to answer questions. Feedback on the directive approach welcome — especially if you've tried rules files and found them too easy to ignore.
