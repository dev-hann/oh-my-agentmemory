/**
 * intent — user-prompt keyword detection.
 *
 * Scans the prompt text for save/forget/recall intents and queues them for
 * the next context directive (see client.pushSessionKeywords).
 *
 * Does NOT call memory_* directly — keeps the LLM as the writer so it can
 * reject false positives. The directive reinforces intent next turn.
 */

import { matchKeywords, summarizeMatches } from "../../../core/keywords.js";
import { createObservation, pushSessionKeywords } from "../client.js";
import { isPhaseDisabled } from "./_shared.js";

const DEBUG = process.env.OH_AM_DEBUG === "1";

interface ChatMessageInput {
  sessionId: string | null;
  project: string | null;
  text: string;
}

export async function onChatMessage(
  input: ChatMessageInput,
): Promise<void> {
  if (isPhaseDisabled("intent")) return;

  const { sessionId, project } = input;
  const text = typeof input.text === "string" ? input.text : "";
  if (!sessionId || text.length === 0) return;

  const matches = matchKeywords(text);
  if (matches.length === 0) return;

  pushSessionKeywords(sessionId, matches);

  await createObservation({
    sessionId,
    hookType: "oh_am_keyword_match",
    project,
    data: {
      text: text.slice(0, 500),
      matches: matches.map((m) => ({
        action: m.action,
        match: m.match,
        patternId: m.patternId,
      })),
      summary: summarizeMatches(matches),
    },
  });

  if (DEBUG) {
    console.error(
      `[oh-am] keywords queued for ${sessionId}: ${summarizeMatches(matches)}`,
    );
  }
}
