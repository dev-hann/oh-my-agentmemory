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
import { observe, pushSessionKeywords } from "../client.js";

const DEBUG = process.env.OH_AM_DEBUG === "1";

function parseDisabledPhases(): Set<string> {
  const raw = process.env.OH_AM_DISABLE ?? "";
  return new Set(
    raw
      .split(/[,\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

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
  const disabled = parseDisabledPhases();
  if (disabled.has("intent")) return;

  const sessionId = input.sessionID ?? input.sessionId ?? null;
  if (!sessionId || !output?.parts) return;

  for (const part of output.parts) {
    if (part?.type !== "text" || !part.text) continue;
    const matches = matchKeywords(part.text);
    if (matches.length === 0) continue;

    pushSessionKeywords(sessionId, matches);

    await observe(sessionId, "oh_am_keyword_match", input.project ?? null, {
      text: part.text.slice(0, 500),
      matches: matches.map((m) => ({
        action: m.action,
        match: m.match,
        patternId: m.patternId,
      })),
      summary: summarizeMatches(matches),
    });

    if (DEBUG) {
      console.error(
        `[oh-am] keywords queued for ${sessionId}: ${summarizeMatches(matches)}`,
      );
    }
  }
}
