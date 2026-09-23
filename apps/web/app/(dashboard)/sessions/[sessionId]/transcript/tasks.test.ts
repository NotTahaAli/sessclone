import { describe, expect, it } from 'vitest'

import type { Item } from '@sessclone/shared'

import { taskStatuses } from './tasks'

const note = (id: string, status: string) =>
  `<task-notification>\n<task-id>${id}</task-id>\n<status>${status}</status>\n</task-notification>`
const base = { at: null, raw: null }

describe('taskStatuses', () => {
  it('keeps the latest status per task, whatever line carried it', () => {
    const items: Item[] = [
      {
        ...base,
        id: 'c',
        offset: 30,
        kind: 'queue',
        operation: 'enqueue',
        text: note('a1', 'completed'),
      },
      {
        ...base,
        id: 'a',
        offset: 10,
        kind: 'injected',
        text: note('a1', 'running'),
      },
      {
        ...base,
        id: 'b',
        offset: 20,
        kind: 'attachment',
        attachmentType: 'queued_command',
        text: note('b2', 'failed'),
      },
      {
        ...base,
        id: 'd',
        offset: 40,
        kind: 'assistant',
        text: note('b2', 'completed'),
        messageId: null,
        requestId: null,
        model: null,
        effort: null,
        usage: null,
        stopReason: null,
      },
    ]
    expect(taskStatuses(items)).toEqual(
      new Map([
        ['a1', 'completed'],
        ['b2', 'failed'],
      ]),
    )
  })
})
