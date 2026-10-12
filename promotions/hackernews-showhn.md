# Hacker News — Show HN

**Title:** Show HN: I made my coding agent actually use its long-term memory

**Text:**

I use opencode (an open-source coding agent) with agentmemory, an open-source memory server that exposes 54 MCP tools plus a capture plugin recording every session. The read side always worked. The write side never did: over weeks of use my agent never once called memory_save on its own, four pinned context slots stayed empty, and "remember this" produced an acknowledgment and nothing else.

A memory policy written into a rules file didn't survive either. Instructions buried in a long system prompt fade out after a few turns, so the policy gets read once and then ignored.

So I built a plugin that re-injects the memory policy into the system prompt every turn, via opencode's chat.system.transform hook. Repetition is the mechanism. Around that core it bootstraps empty slots on session start, catches intent keywords in English and Korean, saves lessons automatically when file edits carry error signals, and suggests compressing finished work into summaries. High-priority todos become memory-tracked actions.

A month of daily use and new sessions recall past decisions instead of re-deriving them.

It's opencode-only for now; the core is agent-agnostic and Claude Code/Codex adapters are next. Dogfooding surfaced two bugs (a rejected null field, a state leak), both fixed, 72 tests in CI. MIT, installs as an npm plugin with one line in config.

https://github.com/dev-hann/oh-my-agentmemory
