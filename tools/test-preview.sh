#!/usr/bin/env bash
# Flynn preview test runner for the Ahlers Arcade scoreboard.
#
#   tools/test-preview.sh                 # test preview.html (created from index.html if missing)
#   tools/test-preview.sh --init          # (re)copy index.html -> preview.html, then test it (asks before overwriting)
#   tools/test-preview.sh index.html      # test the live file as-is (read-only)
#   tools/test-preview.sh --compare       # before/after: index.html vs preview.html, side-by-side screenshots
#   Extra flags are passed to tools/test-preview.mjs (e.g. --no-cycle, --wait 30000, --strict, --sizes 1920x1080)
#
# Output goes to tools/out/<timestamp>-*/ (gitignored). Exit code: 0 pass, 1 fail, 2 harness error.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ ! -d tools/node_modules/puppeteer-core ]; then
  echo "Installing test deps (tools/node_modules)..."
  (cd tools && npm install --no-audit --no-fund --silent)
fi

init_preview() {
  if [ -f preview.html ] && [ "${1:-}" = "ask" ] && ! cmp -s index.html preview.html; then
    read -r -p "preview.html differs from index.html. Overwrite it with index.html? [y/N] " a
    [ "$a" = "y" ] || [ "$a" = "Y" ] || { echo "Keeping existing preview.html"; return; }
  fi
  cp index.html preview.html
  echo "Copied index.html -> preview.html"
}

case "${1:-}" in
  --init)    shift; init_preview ask; exec node tools/test-preview.mjs --file preview.html "$@" ;;
  --compare) shift; [ -f preview.html ] || init_preview; exec node tools/test-preview.mjs --compare index.html preview.html "$@" ;;
  ""|--*)    [ -f preview.html ] || init_preview; exec node tools/test-preview.mjs --file preview.html "$@" ;;
  *)         f="$1"; shift; exec node tools/test-preview.mjs --file "$f" "$@" ;;
esac
