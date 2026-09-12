#!/usr/bin/env bash
# Regenerates the ticket graph after a ticket file is written.
# Reads the hook payload on stdin and does nothing unless the edited path is a
# ticket, so ordinary edits stay fast.
set -u

payload=$(cat)
case "$payload" in
  *".scratch/sessclone-v1/issues/"*) ;;
  *) exit 0 ;;
esac

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
node "$repo/scripts/ticket-graph.mjs" >/dev/null 2>&1 || true
exit 0
