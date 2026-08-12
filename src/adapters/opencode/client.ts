/**
 * HTTP wrapper around the agentmemory REST API.
 * Used by opencode adapter hooks. Failures are swallowed + logged via OH_AM_DEBUG.
 *
 * URL/secret resolution happens once on first call via loadConfig():
 *   precedence: AGENTMEMORY_URL env > oh-am.jsonc > "http://localhost:3111"
 *
 * ── Naming convention ────────────────────────────────────────────────────
 *   list*    → GET  (collection query with filter params)
 *   get*     → GET  (single resource by identifier)
 *   create*  → POST (new resource)
 *   update*  → POST (mutate existing resource)
 *   replace* → POST (full overwrite — slot semantics)
 *   search*  → POST (query-body search)
 *   fetch*   → POST (external lookup, e.g. file history)
 *
 * ── Server route notes (agentmemory binary, not editable) ────────────────
 * The agentmemory server exposes inconsistent REST paths. We document the
 * actual route above each function. The client presents a unified CRUD-style
 * interface to plugin code; route idiosyncrasies stay here.
 */

import { loadConfig } from "./config.js";
import type {
  Action,
  ActionCreateParams,
  ActionListFilter,
  ActionUpdateParams,
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
    const res = await fetch(`${apiBase()}/agentmemory${path}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok && DEBUG_ENV) {
      console.error(`[oh-am] ${path} → ${res.status}: ${await res.text().catch(() => "")}`);
    }
    return res.ok;
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
// GET /health → boolean (just checks status)

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
// Server routes: GET /slots, GET /slot?label=X, POST /slot/replace
// (singular `/slot/replace` is a server quirk — kept as-is.)

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
// Server routes:
//   GET  /actions?status=X&limit=Y   → list (Aug 7 "Fix A" GET-ified this)
//   POST /actions                    → create (overloaded — NOT /actions/create, which 404s)
//   POST /actions/update             → mutate

interface ActionsListResponse {
  actions?: Action[];
  success?: boolean;
}

interface ActionCreateResponse {
  action?: { id: string };
  success?: boolean;
}

/**
 * List actions with optional filter.
 * `listActions({ status: "done" })` replaces the old `getDoneActions(25)`.
 */
export async function listActions(filter?: ActionListFilter): Promise<Action[]> {
  const params: Record<string, string | number> = {};
  if (filter?.status) params.status = filter.status;
  if (filter?.limit) params.limit = filter.limit;
  const r = await getJson<ActionsListResponse>("/actions", params);
  const actions = r?.actions ?? [];
  // Server may return actions other than the requested status in some builds;
  // filter client-side to be safe.
  if (filter?.status) {
    return actions.filter((a) => a.status === filter.status);
  }
  return actions;
}

/**
 * Create a new action. Returns the new action ID on success, null on failure.
 * NOTE: server uses POST /actions (not /actions/create, which 404s).
 */
export async function createAction(
  params: ActionCreateParams,
): Promise<string | null> {
  const body: Record<string, unknown> = {
    title: params.title,
    priority: params.priority ?? 5,
  };
  if (params.description !== undefined) body.description = params.description;
  if (params.tags !== undefined) {
    // Server expects tags as array, not comma-separated string.
    // String tags cause TypeError in buildChainText (.join on string).
    body.tags = params.tags.split(",").map((t) => t.trim()).filter(Boolean);
  }
  if (params.parentId !== undefined) body.parentId = params.parentId;
  if (params.requires !== undefined) body.requires = params.requires;
  if (params.project !== undefined) body.project = params.project;

  const r = await postJson<ActionCreateResponse>("/actions", body);
  return r?.action?.id ?? null;
}

/**
 * Update an existing action's status, priority, or result.
 * Server route: POST /actions/update.
 */
export async function updateAction(
  actionId: string,
  params: ActionUpdateParams,
): Promise<boolean> {
  const body: Record<string, unknown> = { actionId };
  if (params.status !== undefined) body.status = params.status;
  if (params.priority !== undefined) body.priority = params.priority;
  if (params.result !== undefined) body.result = params.result;
  return postVoid("/actions/update", body);
}

// ── Observations ───────────────────────────────────────────────────────────
// Server route: POST /observe (verb-only path is a server quirk.)

export async function createObservation(params: {
  sessionId: string;
  hookType: string;
  project: string | null;
  data: Record<string, unknown>;
}): Promise<boolean> {
  // Server requires `project` and `cwd` as non-null strings. Fall back to
  // "/" when the caller has no project context (e.g. session-created fires
  // before cwd is known).
  const project = params.project ?? "/";
  const cwd = params.project ?? "/";
  return postVoid("/observe", {
    hookType: params.hookType,
    sessionId: params.sessionId,
    project,
    cwd,
    timestamp: new Date().toISOString(),
    data: params.data,
  });
}

// ── Lessons ────────────────────────────────────────────────────────────────
// Server routes: POST /lessons (create), POST /lessons/search (query-body search)

interface LessonRecallResponse {
  lessons?: Array<{ id: string; content: string; confidence: number }>;
}

export async function searchLessons(
  query: string,
  limit = 5,
): Promise<NonNullable<LessonRecallResponse["lessons"]>> {
  const r = await postJson<LessonRecallResponse>("/lessons/search", {
    query,
    limit,
  });
  return r?.lessons ?? [];
}

export async function createLesson(params: {
  content: string;
  tags: string;
  confidence?: number;
  project?: string;
}): Promise<boolean> {
  const body: Record<string, unknown> = {
    content: params.content,
    tags: params.tags,
    confidence: params.confidence ?? 0.5,
  };
  if (params.project !== undefined) body.project = params.project;
  return postVoid("/lessons", body);
}

// ── Files ──────────────────────────────────────────────────────────────────
// Server route: POST /file-context (returns prompt-string for LLM)

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

export async function fetchFileHistory(
  filePath: string,
  _sessionId?: string,
): Promise<FileHistoryEntry[]> {
  const body: Record<string, unknown> = { files: [filePath] };
  const r = await postJson<{ context?: string }>("/file-context", body);
  return parseFileContext(r?.context ?? "");
}

// ── Crystals ───────────────────────────────────────────────────────────────
// Server route: POST /crystals/create

export async function createCrystal(params: {
  actionIds: string[];
  project?: string;
  sessionId?: string;
}): Promise<boolean> {
  const body: Record<string, unknown> = {
    actionIds: params.actionIds.join(","),
  };
  if (params.project !== undefined) body.project = params.project;
  if (params.sessionId !== undefined) body.sessionId = params.sessionId;
  return postVoid("/crystals/create", body, 15000);
}

// ── Sessions ───────────────────────────────────────────────────────────────
// Server route: GET /sessions?limit=N

interface SessionRow {
  observationCount?: number;
}

interface SessionsResponse {
  sessions?: SessionRow[];
}

export async function listRecentSessions(limit = 10): Promise<SessionRow[]> {
  const r = await getJson<SessionsResponse>("/sessions", { limit });
  const sessions = r?.sessions ?? [];
  return sessions.slice(0, limit);
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
