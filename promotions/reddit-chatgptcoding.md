# Reddit — r/ChatGPTCoding

**Title:** My coding agent had 54 memory tools available. It never called a single one on its own.

**Body:**

I set up agentmemory next to opencode a few months back. Sessions get captured, semantic search works, there's a pile of MCP tools for saving memories and lessons. Great on paper.

Then I looked at the logs after a few weeks. The agent had never once called memory_save on its own. The four pinned context slots (persona, project context, preferences, guidelines) were still empty from day one. I'd type "remember this" and get "Sure!" back, and nothing would land in the database. Saving a lesson after a painful debugging session? Never happened unless I asked twice.

First fix attempt was a rules file, memory.md with a clear policy. Followed for a couple turns, then quietly forgotten. If you've written one of these you know the pattern. Long prompt, instruction buried in the middle, model stops seeing it.

What actually worked was crude. I wrote a plugin that re-injects the memory policy into the system prompt every single turn, through opencode's chat.system.transform hook. Not once at session start. Every turn. The model can't drift away from it because it gets re-surfaced constantly.

Plus a few hooks doing the work the agent wouldn't do itself: empty pinned slots get bootstrapped on session start, "remember this" and "기억해" (it handles Korean too, I write mixed-language prompts) get caught and queued, file edits carrying error signals trigger an automatic lesson save, finished work gets flagged for summarization, and high-priority todos become tracked actions.

Month of daily use since. The change I actually feel: I open a new session and ask about something from last week, and it answers from memory instead of grepping from scratch or making me re-explain.

Honest bits: it's opencode-only right now (the core is deliberately agent-agnostic, Claude Code and Codex adapters are next on the roadmap), and dogfooding caught two real bugs in week one, a null project field the server rejected and a session-state leak. Both fixed. 72 tests in CI now.

It's on npm, install is one line in opencode.json. MIT.

https://github.com/dev-hann/oh-my-agentmemory

If you gave up on memory tooling because the agent never uses it, the problem wasn't the tooling.
