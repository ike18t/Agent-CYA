#!/usr/bin/env bash
# Claude Code PermissionRequest hook adapter for agent-cya

set -euo pipefail

INPUT=$(cat)

# Guard for empty/invalid stdin
if [ -z "$INPUT" ]; then
  echo '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"deny","reason":"empty input"}}}'
  exit 2
fi

# Collapse all jq extraction into a single call for efficiency
AGENT_CYA_INPUT=$(echo "$INPUT" | jq -c '
  .tool_name as $tn |
  (.tool_input // {}) as $ti |
  if $tn == "Bash" then
    {toolType: $tn, command: ($ti.command // ""), fileContent: null, workingDirectory: (.cwd // "")}
  elif $tn == "Write" then
    {toolType: $tn, command: ($ti.file_path // ""), fileContent: ($ti.content // null), workingDirectory: (.cwd // "")}
  elif $tn == "Edit" then
    {toolType: $tn, command: ($ti.file_path // ""), fileContent: (
      {old_string: ($ti.old_string // $ti.oldString // null), new_string: ($ti.new_string // $ti.newString // null)} | tojson
    ), workingDirectory: (.cwd // "")}
  else
    {toolType: $tn, command: ($ti.command // $ti.file_path // ""), fileContent: null, workingDirectory: (.cwd // "")}
  end
')

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_CYA="${SCRIPT_DIR}/../bin/agent-cya"

PLATFORM="${AGENT_CYA_PLATFORM:-claude}"

LOG_FILE="${XDG_STATE_HOME:-$HOME/.local/state}/agent-cya/claude-hook.log"
mkdir -p "$(dirname "$LOG_FILE")"
AGENT_CYA_OUTPUT=$(echo "$AGENT_CYA_INPUT" | "$AGENT_CYA" review --platform "$PLATFORM" 2>>"$LOG_FILE") || true

DECISION=$(echo "$AGENT_CYA_OUTPUT" | jq -r '.decision // "deny"' 2>/dev/null || echo "deny")
REASON=$(echo "$AGENT_CYA_OUTPUT" | jq -r '.reason // "no response"' 2>/dev/null || echo "no response")

# Map agent-cya decisions to PermissionRequest behavior
case "$DECISION" in
  allow) DECISION="allow" ;;
  deny)  DECISION="deny" ;;
  ask)   DECISION="ask" ;;
esac

echo "$AGENT_CYA_OUTPUT" | jq -c \
  --arg behavior "$DECISION" \
  --arg reason "$REASON" \
  '{hookSpecificOutput: {hookEventName: "PermissionRequest", decision: {behavior: $behavior, reason: $reason}}}' \
  || echo "{\"hookSpecificOutput\":{\"hookEventName\":\"PermissionRequest\",\"decision\":{\"behavior\":\"$DECISION\",\"reason\":\"$REASON\"}}}"

if [ "$DECISION" = "deny" ]; then
  exit 2
fi
exit 0
