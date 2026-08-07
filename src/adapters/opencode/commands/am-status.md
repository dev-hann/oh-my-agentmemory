Report agentmemory state — slots, recent saves, lesson count.

1. Call `agentmemory_memory_slot_list` and show which pinned slots are filled vs empty.
2. Call `agentmemory_memory_sessions` (limit 5) and report the most recent sessions with observation counts.
3. Call `agentmemory_memory_lesson_recall` with query="recent" and limit 5 — show the latest lessons.
4. If done actions are visible in the frontier (`agentmemory_memory_frontier`), report how many done actions could be crystallized.

Keep the output under 20 lines. This is a dashboard, not a deep dive.
