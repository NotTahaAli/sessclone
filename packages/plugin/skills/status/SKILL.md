---
name: status
description: Shows whether the sessclone Collector is connected, which Org it reports to, and what is waiting to send.
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/status.mjs")
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/status.mjs"`

Show the lines above to the user exactly as they are, in a code block, with no
commentary. If the connection line says NOT connected, add one sentence: create
a key under Keys in the dashboard, then run /plugin configure sessclone to enter
it, and start a new session.
