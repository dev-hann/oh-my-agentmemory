/**
 * HTTP wrapper around the agentmemory REST API.
 * Used by opencode adapter hooks. Failures are swallowed + logged via OH_AM_DEBUG.
 *
 * URL/secret resolution happens once on first call via loadConfig():
 *   precedence: AGENTMEMORY_URL env > oh-am.jsonc > "http://localhost:3111"
 */

import { loadConfig } from "./config.js";
import type {
  Action,
  FileHistoryEntry,
  KeywordMatch,
  Slot,
  SlotLabel,
} from "../../core/types.js";

let resolvedApi: string | null = null;
let resolvedSecret: string | null = null;
const DEBUG_ENV = process.env.OH_AM_DEBUG === "1";

function apiBase(): string {
  if (resolvedApi !== null) return resolvedApi;
  const cfg = loadConfig();
  resolvedApi = cfg.url;
  resolvedSecret = cfg.secret;
  return resolvedApi;
}

function secretToken(): string {
  if (resolvedSecret !== null) return resolvedSecret;
  const cfg = loadConfig();
  resolvedSecret = cfg.secret;
  return resolvedSecret;
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  const secret = secretToken();
  if (secret) h["Authorization"] = `Bearer ${secret}`;
  return h;
}

async function postJson<T = unknown>(
  path: string,
  body: Record<string, unknown>,
  timeoutMs = 4000,
): Promise<T | null> {
  try {
    const res = await fetch(`${apiBase()}/agentmemory${path}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      if (DEBUG_ENV) console.error(`[oh-am] ${path} → ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (e) {
    if (DEBUG_ENV) console.error(`[oh-am] ${path} failed:`, (e as Error).message);
    return null;
  }
}

async function postVoid(
  path: string,
  body: Record<string, unknown>,
  timeoutMs = 4000,
): Promise<boolean> {
  try {
    await fetch(`${apiBase()}/agentmemory${path}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return true;
  } catch (e) {
    if (DEBUG_ENV) console.error(`[oh-am] ${path} failed:`, (e as Error).message);
    return false;
  }
}

async function getJson<T = unknown>(
  path: string,
  params?: Record<string, string | number>,
  timeoutMs = 4000,
): Promise<T | null> {
  try {
    let url = `${apiBase()}/agentmemory${path}`;
    if (params) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
      url += `?${qs.toString()}`;
    }
    const res = await fetch(url, {
      method: "GET",
      headers: headers(),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      if (DEBUG_ENV) console.error(`[oh-am] GET ${path} → ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (e) {
    if (DEBUG_ENV) console.error(`[oh-am] GET ${path} failed:`, (e as Error).message);
    return null;
  }
}

// ── Health ─────────────────────────────────────────────────────────────────

export async function healthCheck(timeoutMs = 2000): Promise<boolean> {
  try {
    const res = await fetch(`${apiBase()}/agentmemory/health`, {
      method: "GET",
      headers: headers(),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Slots ──────────────────────────────────────────────────────────────────

interface SlotListResponse {
  slots?: Slot[];
  success?: boolean;
}

export async function listSlots(): Promise<Slot[]> {
  const r = await getJson<SlotListResponse>("/slots");
  return r?.slots ?? [];
}

export async function getSlot(label: SlotLabel): Promise<Slot | null> {
  const r = await getJson<{ slot?: Slot; success?: boolean }>("/slot", { label });
  return r?.slot ?? null;
}

export async function replaceSlot(
  label: SlotLabel,
  content: string,
): Promise<boolean> {
  return postVoid("/slot/replace", { label, content });
}

export function emptySlotLabels(slots: Slot[]): string[] {
  return slots
    .filter((s) => s.pinned && (s.content ?? "").trim().length === 0)
    .map((s) => s.label);
}

// ── Actions ────────────────────────────────────────────────────────────────

interface FrontierResponse {
  actions?: Action[];
}

export async function getDoneActions(limit = 25): Promise<Action[]> {
  const r = await getJson<FrontierResponse>("/actions", { status: "done", limit });
  const actions = r?.actions ?? [];
  return actions.filter((a) => a.status === "done");
}

// ── Sessions ───────────────────────────────────────────────────────────────

interface SessionRow {
  observationCount?: number;
}

interface SessionsResponse {
  sessions?: SessionRow[];
}

export async function getRecentSessions(limit = 10): Promise<SessionRow[]> {
  const r = await getJson<SessionsResponse>("/sessions", { limit });
  const sessions = r?.sessions ?? [];
  return sessions.slice(0, limit);
}

// ── File history ───────────────────────────────────────────────────────────

/**
 * Parse a `<agentmemory-file-context>` prompt string into structured entries.
 * Each observation line has the shape: `- [TYPE] Title: Narrative`.
 * The tool_output field carries the full "Title: Narrative" so that
 * buildLessonFromFileHistory's error-signal scan can match keywords.
 */
function parseFileContext(context: string): FileHistoryEntry[] {
  if (typeof context !== "string" || context.length === 0) return [];
  const entries: FileHistoryEntry[] = [];
  for (const line of context.split("\n")) {
    const m = line.match(/^-\s+\[([^\]]+)\]\s*(.*)$/);
    if (!m) continue;
    entries.push({
      sessionId: "",
      timestamp: "",
      data: { tool_name: m[1], tool_output: m[2] },
    });
  }
  return entries;
}

export async function getFileHistory(
  filePath: string,
  _sessionId?: string,
): Promise<FileHistoryEntry[]> {
  const body: Record<string, unknown> = { files: [filePath] };
  const r = await postJson<{ context?: string }>("/file-context", body);
  return parseFileContext(r?.context ?? "");
}

// ── Lessons ────────────────────────────────────────────────────────────────

interface LessonRecallResponse {
  lessons?: Array<{ id: string; content: string; confidence: number }>;
}

export async function recallLessons(
  query: string,
  limit = 5,
): Promise<NonNullable<LessonRecallResponse["lessons"]>> {
  const r = await postJson<LessonRecallResponse>("/lessons/search", {
    query,
    limit,
  });
  return r?.lessons ?? [];
}

export async function saveLesson(
  content: string,
  tags: string,
  confidence = 0.5,
  project?: string,
): Promise<boolean> {
  const body: Record<string, unknown> = { content, tags, confidence };
  if (project) body.project = project;
  return postVoid("/lessons", body);
}

// ── Crystal ────────────────────────────────────────────────────────────────

export async function crystallize(
  actionIds: string[],
  project?: string,
  sessionId?: string,
): Promise<boolean> {
  const body: Record<string, unknown> = {
    actionIds: actionIds.join(","),
  };
  if (project) body.project = project;
  if (sessionId) body.sessionId = sessionId;
  return postVoid("/crystals/create", body, 15000);
}

// ── Observe (for plugin self-tracking) ─────────────────────────────────────

export function observe(
  sessionId: string,
  hookType: string,
  project: string | null,
  data: Record<string, unknown>,
): Promise<boolean> {
  return postVoid("/observe", {
    hookType,
    sessionId,
    project,
    cwd: project,
    timestamp: new Date().toISOString(),
    data,
  });
}

// ── Keyword pending state (in-memory, session-scoped) ──────────────────────
// Chat-message hook writes here, system-transform reads. Adapters do not
// share memory across plugin loads, so this is best-effort: keywords only
// reinforce the next turn within the same plugin process.

interface SessionKeywordState {
  pending: KeywordMatch[];
  updatedAt: number;
}

const SESSION_KEYWORD_TTL_MS = 5 * 60 * 1000;
const sessionKeywords = new Map<string, SessionKeywordState>();

export function pushSessionKeywords(
  sessionId: string,
  matches: KeywordMatch[],
): void {
  if (matches.length === 0) return;
  const existing = sessionKeywords.get(sessionId)?.pending ?? [];
  const merged = [...existing, ...matches].slice(-20);
  sessionKeywords.set(sessionId, {
    pending: merged,
    updatedAt: Date.now(),
  });
}

export function drainSessionKeywords(sessionId: string): KeywordMatch[] {
  const state = sessionKeywords.get(sessionId);
  if (!state) return [];
  if (Date.now() - state.updatedAt > SESSION_KEYWORD_TTL_MS) {
    sessionKeywords.delete(sessionId);
    return [];
  }
  sessionKeywords.delete(sessionId);
  return state.pending;
}
