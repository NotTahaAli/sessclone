#!/bin/sh
# Forwards one hook payload to the sink. Never blocks and never fails the hook:
# a non-zero exit prints an error notice on every turn, and a hung POST would
# change the very timing this spike is measuring.
payload=$(cat)
curl -s -m 2 -X POST "${SPIKE05_SINK:-http://127.0.0.1:8477}" \
  -H 'content-type: application/json' \
  -d "{\"event\":\"$1\",\"payload\":$payload}" >/dev/null 2>&1 || true
exit 0
