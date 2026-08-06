#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CURSOR_DIR="${CURSOR_DIR:-$HOME/.cursor}"
KEEP_DATA=true

usage() {
  cat <<EOF
Usage: $(basename "$0") [--purge-data]

Remove cursor-memory hooks, skills, and hook registrations from ~/.cursor.

Options:
  --purge-data  Also delete ~/.cursor/memory/ (captures + registry)
  -h, --help    Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --purge-data) KEEP_DATA=false; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

echo "Uninstalling cursor-memory"

node "$REPO_DIR/scripts/merge-hooks.js" uninstall

for hook in memory-lib.js memory-session-start.js memory-capture.js; do
  target="$CURSOR_DIR/hooks/$hook"
  if [[ -L "$target" ]]; then
    rm "$target"
    echo "removed link $target"
  elif [[ -f "$target" ]]; then
    rm "$target"
    echo "removed $target"
  fi
done

for skill in memory-read memory-consolidate; do
  target="$CURSOR_DIR/skills/$skill"
  if [[ -e "$target" ]]; then
    rm -rf "$target"
    echo "removed $target"
  fi
done

if [[ "$KEEP_DATA" == false && -d "$CURSOR_DIR/memory" ]]; then
  rm -rf "$CURSOR_DIR/memory"
  echo "purged $CURSOR_DIR/memory"
else
  echo "kept $CURSOR_DIR/memory (use --purge-data to delete)"
fi

echo "Done."
