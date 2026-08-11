#!/usr/bin/env bash
set -euo pipefail

CURSOR_DIR="${CURSOR_DIR:-$HOME/.cursor}"
MEMORY_DIR="$CURSOR_DIR/memory"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FAIL=0

ok() { echo "ok  $1"; }
bad() { echo "FAIL $1"; FAIL=1; }
warn() { echo "warn $1"; }

echo "cursor-memory doctor"
echo "repo: $REPO_DIR"
echo ""

check_link() {
  local dest="$1"
  local label="$2"
  if [[ ! -e "$dest" && ! -L "$dest" ]]; then
    bad "$label missing: $dest"
    return
  fi
  if [[ -L "$dest" ]] && [[ ! -e "$dest" ]]; then
    bad "$label broken symlink: $dest -> $(readlink "$dest" 2>/dev/null || echo '?')"
    return
  fi
  ok "$label"
}

for hook in memory-lib.js memory-git.js memory-session-start.js memory-capture.js memory-extract-runner.js memory-consolidate-runner.js; do
  check_link "$CURSOR_DIR/hooks/$hook" "hook $hook"
done

for skill in memory-read memory-extract memory-consolidate; do
  check_link "$CURSOR_DIR/skills/$skill" "skill $skill"
done

if node "$CURSOR_DIR/hooks/memory-session-start.js" <<< '{}' | grep -q 'additional_context'; then
  ok "sessionStart hook runs"
else
  bad "sessionStart hook failed or returned empty"
fi

if command -v cursor >/dev/null 2>&1; then
  ok "cursor CLI: $(command -v cursor)"
  if cursor agent models 2>/dev/null | grep -q 'gpt-5.6-luna'; then
    ok "extract model gpt-5.6-luna available"
  else
    warn "gpt-5.6-luna not in cursor agent models — set MEMORY_MODEL"
  fi
else
  warn "cursor CLI not on PATH — background extract/consolidate will fail"
fi

if command -v git >/dev/null 2>&1; then
  ok "git: $(command -v git)"
else
  warn "git not on PATH — workspace diff will fail"
fi

stage1=0
stuck_locks=0
if [[ -d "$MEMORY_DIR/raw/stage1" ]]; then
  stage1=$(find "$MEMORY_DIR/raw/stage1" -maxdepth 1 -name '*.json' 2>/dev/null | wc -l | tr -d ' ')
  stuck_locks=$(find "$MEMORY_DIR/raw/stage1" -maxdepth 1 -name '*.lock' 2>/dev/null | wc -l | tr -d ' ')
fi
echo ""
echo "stage-1 extractions: $stage1 (consolidate at ${MEMORY_CONSOLIDATE_THRESHOLD:-3})"
if [[ "$stuck_locks" -gt 0 ]]; then
  warn "$stuck_locks stale extract lock(s) in raw/stage1 — run: npm run retry-extract -- --clear-stuck"
fi
echo "model: ${MEMORY_MODEL:-gpt-5.6-luna-medium}"
echo "sandbox: ${MEMORY_SANDBOX:-enabled}"

if [[ -f "$MEMORY_DIR/state/last-capture.json" ]]; then
  echo "last capture state:"
  cat "$MEMORY_DIR/state/last-capture.json"
else
  warn "no last-capture.json yet — hooks may not have fired"
fi

echo ""
if [[ -f "$MEMORY_DIR/state/capture.log" ]]; then
  echo "capture.log (last 5):"
  tail -5 "$MEMORY_DIR/state/capture.log"
else
  warn "no capture.log yet — finish an agent chat and check again"
fi

echo ""
if [[ -f "$MEMORY_DIR/state/extract.log" ]]; then
  echo "extract.log (last 5):"
  tail -5 "$MEMORY_DIR/state/extract.log"
fi

echo ""
if [[ -f "$MEMORY_DIR/state/consolidate.log" ]]; then
  echo "consolidate.log (last 5):"
  tail -5 "$MEMORY_DIR/state/consolidate.log"
fi

echo ""
if [[ "$FAIL" -ne 0 ]]; then
  echo "Fix: cd $REPO_DIR && ./install.sh --link"
  exit 1
fi

echo "Hooks look healthy. Luna extracts memories from completed chats; consolidate runs at threshold with git diff."
echo "Test: complete a coding chat, then watch extract.log and raw/stage1/."
