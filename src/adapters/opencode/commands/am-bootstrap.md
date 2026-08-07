Force re-bootstrap of empty pinned slots right now.

1. Call `agentmemory_memory_slot_list` to see current slot state.
2. For any pinned slot among (persona, project_context, user_preferences, tool_guidelines) that is empty, propose a default content based on the current cwd and project structure.
3. Show the proposed content for each empty slot and ask the user for confirmation before calling `agentmemory_memory_slot_replace`.
4. For non-empty slots, leave them alone.

This is the manual override for the automatic bootstrap that runs at session.created. Use it when the cwd project detection was wrong or when slots were cleared.
