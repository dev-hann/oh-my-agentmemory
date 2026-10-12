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
# Append a value to `key` under [section], preserving what is already there.
#   key absent            -> key = ["value"]
#   key = ["existing"]    -> key = ["existing", "value"]
#   key = ["ours"]        -> skip (already registered)
#   key = "scalar"        -> key = ["scalar-as-is", "value"] (promote to array)
ensure_array_entry() {
  local section="$1" key="$2" value="$3"
  local tmp="${CONFIG_TOML}.tmp"

  # Already registered under this section?
  if awk -v sec="^[${section}]" -v key="^${key} =" '
    $0 ~ sec { insec=1; next } /^\[/ { insec=0 }
    insec && $0 ~ key { found=1; print; next }
    { print }
  ' "$CONFIG_TOML" | grep -qF "${value}"; then
    echo "  = ${key} already registered, skipping"
    return
  fi

  if ! grep -q "^\[${section}\]" "$CONFIG_TOML" 2>/dev/null; then
    { echo ""; echo "[${section}]"; echo "${key} = [\"${value}\"]"; } >> "$CONFIG_TOML"
    echo "  + ${key}"
    return
  fi

  python3 - "$CONFIG_TOML" "$section" "$key" "$value" <<'PY'
import re, sys
path, section, key, value = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
src = open(path).read()
sec_re = re.compile(rf"(?m)^\[{re.escape(section)}\]\s*$")
m = sec_re.search(src)
assert m, f"[{section}] header vanished"
# Bounds of the section body.
nxt = re.search(r"(?m)^\[", src[m.end():])
end = m.end() + nxt.start() if nxt else len(src)
body = src[m.end():end]
key_re = re.compile(rf"(?m)^{re.escape(key)}\s*=\s*(.+)$")
km = key_re.search(body)
if not km:
    newline = f"{key} = [\"{value}\"]\n"
    body = newline + body
else:
    cur = km.group(1).strip()
    if cur.startswith("["):
        inner = cur[1:cur.rindex("]")].rstrip().rstrip(",")
        new = f'{key} = [{inner}, "{value}"]'
    else:
        new = f'{key} = [{cur}, "{value}"]'
    body = body[:km.start()] + new + "\n" + body[km.end():]
open(path, "w").write(src[:m.end()] + body + src[end:])
PY
  echo "  + ${key}"
}

ensure_hook_entry() {
  ensure_array_entry "hooks" "$1" "$2"
}

# Append `key = [value]` under [prompt], creating the section if needed.
ensure_prompt_entry() {
  ensure_array_entry "prompt" "$1" "$2"
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

## IMPORTANT: which memory
"memory" here means the **agentmemory MCP server** (agentmemory_* tools), NOT jcode's built-in memory tool. Built-in memory calls do NOT count.

## Recall
- Need past context (recent work, decisions, prior bugs)? Call agentmemory_search or agentmemory_recall BEFORE exploring files.
- Trivial tasks (single-file read, grep, arithmetic) skip agentmemory calls.

## Write
- After architectural or non-obvious technical decisions, call agentmemory_save (memory_save on the agentmemory server) with the decision and concepts.
- Discovered an effective or ineffective approach? Call agentmemory_lesson_save with what worked / what to avoid.
- New module, build pipeline, or project structure? Update the project_context slot.
- Unfinished work or follow-up promised? Record it in pending items before the session ends.
- Never claim "memory updated" without an actual agentmemory tool call in this turn. jcode built-in memory calls do not count.

## Crystal
- Three or more completed agentmemory actions in this session? Recall first to check for an existing crystal, then crystallize with the done action IDs.
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

  # 5. Register the agentmemory MCP server (jcode reads ~/.jcode/mcp.json).
  if [ ! -f "${JCODE_DIR}/mcp.json" ]; then
    cat > "${JCODE_DIR}/mcp.json" <<'MCPCFG'
{
  "mcpServers": {
    "agentmemory": {
      "command": "npx",
      "args": ["-y", "@agentmemory/mcp"],
      "timeout_secs": 60
    }
  }
}
MCPCFG
    echo "  + mcp.json → ${JCODE_DIR}/mcp.json"
  elif grep -q '"agentmemory"' "${JCODE_DIR}/mcp.json" 2>/dev/null; then
    echo "  = agentmemory MCP already registered"
  else
    echo "  ! ${JCODE_DIR}/mcp.json exists without agentmemory — add it manually"
  fi

  # 6. Verify: run session_start once against the live server.
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
