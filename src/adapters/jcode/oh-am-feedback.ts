/**
 * oh-my-agentmemory — jcode post_tool_feedback hook.
 *
 * jcode appends this script's stdout to the tool result the model sees
 * (capped 8 KB). We use it as a lightweight reinforcement of the memory
 * policy: a short, throttled reminder that the agent should be writing to
 * agentmemory. The full policy lives in the system prompt via
 * [prompt] overlay_files (see scripts/install-jcode.sh); this hook only
 * nudges, it does not carry the whole policy.
 *
 * Throttle: at most one reminder per 10 tool calls per session, so the
 * reminder stays rare enough to remain noticeable. State is kept on disk
 * in the OS temp dir (hook processes are short-lived).
 *
 * Output contract: empty stdout adds nothing (jcode docs/HOOKS.md).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const STATE_DIR = path.join(os.tmpdir(), "oh-am-jcode");
const EVERY_N_CALLS = 10;

function counterFile(sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48);
  return path.join(STATE_DIR, `${safe}.count`);
}

function shouldRemind(sessionId: string): boolean {
  try {
    if (!existsSync(STATE_DIR)) {
      mkdirSync(STATE_DIR, { recursive: true });
    }
    const file = counterFile(sessionId);
    const count = existsSync(file) ? parseInt(readFileSync(file, "utf8"), 10) || 0 : 0;
    const next = count + 1;
    writeFileSync(file, String(next));
    return next % EVERY_N_CALLS === 0;
  } catch {
    return false;
  }
}

const sessionId = process.env.JCODE_HOOK_SESSION_ID ?? "";
if (sessionId && shouldRemind(sessionId)) {
  process.stdout.write(
    "[oh-am reminder] Use agentmemory MCP tools proactively: memory_save after non-obvious decisions, memory_lesson_save for effective/ineffective approaches, memory_slot_replace for project_context/pending_items updates. Never claim memory was updated without an actual memory_* call this turn.",
  );
}
