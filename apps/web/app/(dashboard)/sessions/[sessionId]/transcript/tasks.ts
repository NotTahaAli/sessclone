import type { Item } from '@sessclone/shared'

// A background agent's own transcript cannot say it finished: its last
// message may carry no stop reason at all. The parent can: Claude Code tells
// it with a `<task-notification>` naming the agent's id as the task id and a
// status. It reaches the transcript as a user line, a queued command or an
// attachment, so every text-bearing Item is scanned.

const NOTIFICATION =
  /<task-notification>[\s\S]*?<task-id>([^<]+)<\/task-id>[\s\S]*?<status>([^<]+)<\/status>/g

/** The latest status per task id, in file order. */
export const taskStatuses = (items: Item[]): Map<string, string> => {
  const statuses = new Map<string, string>()
  const ordered = items.toSorted((a, b) => a.offset - b.offset)
  for (const item of ordered) {
    if (
      item.kind !== 'user' &&
      item.kind !== 'injected' &&
      item.kind !== 'queue' &&
      item.kind !== 'attachment'
    ) {
      continue
    }
    if (!item.text.includes('<task-notification>')) continue
    for (const [, id, status] of item.text.matchAll(NOTIFICATION)) {
      if (id && status) statuses.set(id.trim(), status.trim())
    }
  }
  return statuses
}
