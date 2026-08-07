/**
 * intent — chat-message keyword detection.
 *
 * Scans user messages for save/forget/recall intents and queues them for
 * the next system-transform directive (see client.pushSessionKeywords).
 *
 * Does NOT call memory_* directly — keeps the LLM as the writer so it can
 * reject false positives. The directive reinforces intent next turn.
 */

import { matchKeywords, summarizeMatches } from "../../../core/keywords.js";
import { observe, pushSessionKeywords, saveMemory } from "../client.js";
import { getConfig, isMcpOnly, isPhaseDisabled } from "./_shared.js";

const DEBUG = process.env.OH_AM_DEBUG === "1";

interface ChatMessageInput {
  sessionID?: string;
  sessionId?: string;
  project?: string | null;
}

interface ChatMessageOutput {
  parts?: Array<{ type: string; text?: string }>;
}

export async function onChatMessage(
  input: ChatMessageInput,
  output: ChatMessageOutput,
): Promise<void> {
  if (isPhaseDisabled("intent")) return;

  const sessionId = input.sessionID ?? input.sessionId ?? null;
  if (!sessionId || !output?.parts) return;

  const cfg = getConfig();
  const project = input.project ?? null;
  const mcpOnlyAutoSave =
    isMcpOnly() && cfg.mcpOnly.autoSaveOnKeyword;

  for (const part of output.parts) {
    if (part?.type !== "text" || !part.text) continue;
    const matches = matchKeywords(part.text);
    if (matches.length === 0) continue;

    pushSessionKeywords(sessionId, matches);

    // In mcp-only mode with autoSaveOnKeyword, save directly when "save"
    // keyword matched. We extract the surrounding ~300 chars as content.
    if (mcpOnlyAutoSave) {
      const saveMatches = matches.filter((m) => m.action === "save");
      for (const m of saveMatches) {
        const start = Math.max(0, m.index - 100);
        const end = Math.min(part.text.length, m.index + 200);
        const snippet = part.text.slice(start, end).trim();
        if (snippet.length > 10) {
          await saveMemory({
            content: snippet,
            concepts: `user-intent,${m.patternId}`,
            type: "fact",
            project: project ?? undefined,
          });
        }
      }
    }

    await observe(sessionId, "oh_am_keyword_match", project, {
      text: part.text.slice(0, 500),
      matches: matches.map((m) => ({
        action: m.action,
        match: m.match,
        patternId: m.patternId,
      })),
      summary: summarizeMatches(matches),
      autoSaved: mcpOnlyAutoSave,
    });

    if (DEBUG) {
      console.error(
        `[oh-am] keywords queued for ${sessionId}: ${summarizeMatches(matches)}` +
          (mcpOnlyAutoSave ? " (auto-saved)" : ""),
      );
    }
  }
}
