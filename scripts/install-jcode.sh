#!/usr/bin/env bash
# oh-my-agentmemory — jcode installer.
#
# Installs:
#   1. Hook entry scripts → ~/.jcode/plugins/oh-am/
#   2. Lifecycle hook registrations appended to [hooks] in ~/.jcode/config.toml
#      (array values; existing entries preserved)
#   3. Policy overlay → ~/.jcode/overlays/oh-am.md, registered under
#      [prompt] overlay_files (requires jcode with #1802)
#   4. Config → ~/.jcode/oh-am.jsonc (created with defaults if absent;
#      the opencode config is NOT migrated automatically)
#
# Usage:
#   scripts/install-jcode.sh            install / update
#   scripts/install-jcode.sh --remove   uninstall (removes what we added)
#
# Idempotent: re-running never duplicates entries (marker-based).
# Requires: bun (https://bun.sh), a running agentmemory server (default
# http://localhost:3111).

set -euo pipefail

JCODE_DIR="${HOME}/.jcode"
PLUGIN_DIR="${JCODE_DIR}/plugins/oh-am"
OVERLAY_DIR="${JCODE_DIR}/overlays"
CONFIG_TOML="${JCODE_DIR}/config.toml"
OH_AM_CONFIG="${JCODE_DIR}/oh-am.jsonc"
OVERLAY_FILE="${OVERLAY_DIR}/oh-am.md"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENTRY_SRC="${REPO_ROOT}/src/adapters/jcode/jcode-entry.ts"
FEEDBACK_SRC="${REPO_ROOT}/src/adapters/jcode/oh-am-feedback.ts"

MARKER="# oh-am (managed by scripts/install-jcode.sh)"

# ── helpers ────────────────────────────────────────────────────────────────

toml_has_line() { grep -qF "$1" "$CONFIG_TOML" 2>/dev/null; }

# Append `key = [value]` under [hooks], creating the section if needed.
# Skips when the exact line already exists (idempotency).
ensure_hook_entry() {
  local key="$1" value="$2" line
  line="${key} = [\"${value}\"]"
  if toml_has_line "$line"; then
    echo "  = ${key} already registered, skipping"
    return
  fi
  if grep -q '^\[hooks\]' "$CONFIG_TOML" 2>/dev/null; then
    # Insert right after the [hooks] header.
    awk -v line="$line" '
      { print }
      /^\[hooks\]/ && !done { print line; done=1 }
    ' "$CONFIG_TOML" > "${CONFIG_TOML}.tmp"
  else
    { echo ""; echo "[hooks]"; echo "$line"; } >> "$CONFIG_TOML"
    cp "$CONFIG_TOML" "${CONFIG_TOML}.tmp"
  fi
  mv "${CONFIG_TOML}.tmp" "$CONFIG_TOML"
  echo "  + ${key}"
}

# Append `key = [value]` under [prompt], creating the section if needed.
ensure_prompt_entry() {
  local key="$1" value="$2" line
  line="${key} = [\"${value}\"]"
  if toml_has_line "$line"; then
    echo "  = ${key} already registered, skipping"
    return
  fi
  if grep -q '^\[prompt\]' "$CONFIG_TOML" 2>/dev/null; then
    awk -v line="$line" '
      { print }
      /^\[prompt\]/ && !done { print line; done=1 }
    ' "$CONFIG_TOML" > "${CONFIG_TOML}.tmp"
  else
    { echo ""; echo "[prompt]"; echo "$line"; } >> "$CONFIG_TOML"
    cp "$CONFIG_TOML" "${CONFIG_TOML}.tmp"
  fi
  mv "${CONFIG_TOML}.tmp" "$CONFIG_TOML"
  echo "  + ${key}"
}

remove_lines() {
  # Drop any line mentioning our marker or our install paths.
  if [ -f "$CONFIG_TOML" ]; then
    grep -v -F -e "$MARKER" -e "${PLUGIN_DIR}/" -e "${OVERLAY_FILE}" \
      "$CONFIG_TOML" > "${CONFIG_TOML}.tmp" || true
    mv "${CONFIG_TOML}.tmp" "$CONFIG_TOML"
  fi
}

# ── commands ───────────────────────────────────────────────────────────────

remove_all() {
  echo "Removing oh-am jcode integration..."
  remove_lines
  rm -rf "$PLUGIN_DIR"
  rm -f "$OVERLAY_FILE"
  rm -f "$OH_AM_CONFIG"
  echo "Done. jcode picks up config changes without a restart."
}

install_all() {
  for f in "$ENTRY_SRC" "$FEEDBACK_SRC"; do
    [ -f "$f" ] || { echo "missing $f — run from the repo root"; exit 1; }
  done
  command -v bun >/dev/null || { echo "bun is required (https://bun.sh)"; exit 1; }

  echo "Installing oh-am for jcode..."

  # 1. Copy scripts (plain copy — bun runs TS directly; no build step).
  mkdir -p "$PLUGIN_DIR"
  # The entry imports ./config.js — keep the jcode adapter's layout.
  mkdir -p "$PLUGIN_DIR/src/adapters/jcode" \
           "$PLUGIN_DIR/src/adapters/opencode/hooks" \
           "$PLUGIN_DIR/src/core"
  cp "$ENTRY_SRC" "$FEEDBACK_SRC" "$PLUGIN_DIR/src/adapters/jcode/"
  cp "${REPO_ROOT}/src/adapters/jcode/config.ts" "$PLUGIN_DIR/src/adapters/jcode/"
  cp "${REPO_ROOT}/src/adapters/opencode/config.ts" \
     "${REPO_ROOT}/src/adapters/opencode/client.ts" \
     "${REPO_ROOT}/src/adapters/opencode/mode.ts" \
     "${REPO_ROOT}/src/adapters/opencode/compaction-runner.ts" \
     "${REPO_ROOT}/src/adapters/opencode/compaction-deleter.ts" \
     "$PLUGIN_DIR/src/adapters/opencode/" 2>/dev/null || true
  cp -r "${REPO_ROOT}/src/adapters/opencode/hooks/." "$PLUGIN_DIR/src/adapters/opencode/hooks/"
  cp -r "${REPO_ROOT}/src/core/." "$PLUGIN_DIR/src/core/"
  mkdir -p "$PLUGIN_DIR/src/data"
  cp -r "${REPO_ROOT}/src/data/." "$PLUGIN_DIR/src/data/"

  echo "  + scripts → ${PLUGIN_DIR}"

  # 2. Hook registrations.
  ensure_hook_entry "session_start"     "${PLUGIN_DIR}/src/adapters/jcode/jcode-entry.ts"
  ensure_hook_entry "post_tool"         "${PLUGIN_DIR}/src/adapters/jcode/jcode-entry.ts"
  ensure_hook_entry "turn_end"          "${PLUGIN_DIR}/src/adapters/jcode/jcode-entry.ts"
  ensure_hook_entry "session_end"       "${PLUGIN_DIR}/src/adapters/jcode/jcode-entry.ts"
  ensure_hook_entry "post_tool_feedback" "${PLUGIN_DIR}/src/adapters/jcode/oh-am-feedback.ts"

  # 3. Policy overlay + [prompt] overlay_files.
  if [ ! -f "$OVERLAY_FILE" ]; then
    mkdir -p "$OVERLAY_DIR"
    cat > "$OVERLAY_FILE" <<'POLICY'
# agentmemory policy (oh-am)

Use agentmemory MCP tools proactively. These rules override default behavior.

## Recall
- Need past context (recent work, decisions, prior bugs)? Call memory_recall or memory_search BEFORE exploring files.
- Trivial tasks (single-file read, grep, arithmetic) skip memory calls.

## Write
- After architectural or non-obvious technical decisions, call memory_save with the decision and concepts.
- Discovered an effective or ineffective approach? Call memory_lesson_save with what worked / what to avoid.
- New module, build pipeline, or project structure? Save it to project context (memory_update with concepts: project_context).
- Unfinished work or follow-up promised? Record it in pending items before the session ends.
- Never claim "memory updated" without an actual memory_* tool call in this turn.

## Crystal
- Three or more completed actions in this session? Recall first to check for an existing crystal, then crystallize with the done action IDs.
- Pure exploration with zero file changes → skip crystallize.
POLICY
    echo "  + overlay → ${OVERLAY_FILE}"
  else
    echo "  = overlay exists, keeping user edits"
  fi
  ensure_prompt_entry "overlay_files" "$OVERLAY_FILE"

  # 4. Default config if absent.
  if [ ! -f "$OH_AM_CONFIG" ]; then
    cat > "$OH_AM_CONFIG" <<'CFG'
{
  // oh-my-agentmemory — jcode adapter config.
  // Full option list: see README.md in the oh-my-agentmemory repo.
  "url": "http://localhost:3111",
  "secret": "",
  "mode": "full",
  "healthCheckOnBoot": true,
  "healthCheckTimeoutMs": 2000,
  "healthCheckFatal": false,
  "sessionGc": { "enabled": true, "maxAgeDays": 7 },
  "debug": false
}
CFG
    echo "  + config → ${OH_AM_CONFIG}"
  else
    echo "  = config exists, keeping"
  fi

  # 5. Verify: run session_start once against the live server.
  echo "Verifying (session_start against agentmemory)..."
  if OH_AM_DEBUG=1 \
     JCODE_HOOK_EVENT=session_start \
     JCODE_HOOK_SESSION_ID="oh-am-install-check-$(date +%s)" \
     JCODE_HOOK_CWD="$PWD" \
     bun "$PLUGIN_DIR/src/adapters/jcode/jcode-entry.ts"; then
    echo "OK."
  else
    echo "Warning: verification run failed — check agentmemory server."
  fi
  echo "Done. jcode picks up config changes without a restart."
}

case "${1:-}" in
  --remove) remove_all ;;
  "") install_all ;;
  *) echo "usage: $0 [--remove]"; exit 1 ;;
esac
