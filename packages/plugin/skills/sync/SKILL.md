---
name: sync
description: Sends everything the sessclone Collector has waiting now, instead of at the next session start.
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/request-sync.mjs")
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/request-sync.mjs"`

Reply with the line above and nothing else. The sync runs when this reply ends,
and its result appears below it.
