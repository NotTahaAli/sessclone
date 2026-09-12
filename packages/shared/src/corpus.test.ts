import { readdirSync, readFileSync } from 'node:fs'

import { expect, test } from 'vitest'

// Ticket 08's acceptance criteria, made executable. These assert facts about
// the committed corpus rather than about any parser — so a fixture that is
// re-captured from a newer Claude Code and quietly loses a case fails here,
// which is the whole point of committing the corpus at all.
const DIRECTORY = new URL('../fixtures/transcripts/', import.meta.url)

// Only the fields these assertions reach for. A transcript entry carries many
// more; the redactor is what decides which survive, not this shape.
type Entry = {
  type?: string
  uuid?: string
  timestamp?: string
  agentId?: string
  sessionId?: string
  message?: { id?: string; usage?: { output_tokens?: number } }
}

// JSON.parse returns any, so naming the return type here is the one place the
// untyped boundary is crossed — and it is a declaration, not an assertion.
const parseEntry = (line: string): Entry => JSON.parse(line)

const corpus = readdirSync(DIRECTORY)
  .filter((file) => file.endsWith('.jsonl'))
  .map((file) => ({
    file,
    entries: readFileSync(new URL(file, DIRECTORY), 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map(parseEntry),
  }))

const everyString = (value: unknown): string[] => {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(everyString)
  if (value !== null && typeof value === 'object')
    return Object.values(value).flatMap(everyString)
  return []
}

const assistantsByMessageId = (entries: Entry[]) => {
  const groups = new Map<string, Entry[]>()
  for (const entry of entries) {
    const id = entry.message?.id
    if (entry.type !== 'assistant' || id === undefined) continue
    groups.set(id, [...(groups.get(id) ?? []), entry])
  }
  return [...groups.values()]
}

test('no fixture carries a long string that is not a redaction placeholder', () => {
  // 64 characters is comfortably longer than every identifier Claude Code
  // writes (a uuid is 36) and far shorter than any real prose or tool output,
  // so anything longer is content that escaped the allowlist.
  const leaked = corpus.flatMap(({ file, entries }) =>
    entries
      .flatMap(everyString)
      .filter((text) => text.length > 64 && !/^\[redacted:\d+\]$/.test(text))
      .map((text) => `${file}: ${text.slice(0, 60)}`),
  )

  expect(leaked).toEqual([])
})

test('the corpus still contains the usage numbers cost is computed from', () => {
  const priced = corpus.flatMap(({ entries }) =>
    entries.filter(
      (entry) => typeof entry.message?.usage?.output_tokens === 'number',
    ),
  )

  expect(priced.length).toBeGreaterThan(20)
})

test('the corpus contains multi-block entries sharing one message id', () => {
  const shared = corpus.flatMap(({ file, entries }) =>
    assistantsByMessageId(entries)
      .filter((group) => group.length > 1)
      .map((group) => ({
        file,
        identical:
          new Set(group.map((entry) => JSON.stringify(entry.message?.usage)))
            .size === 1,
      })),
  )

  // Both cases have to be present. Identical usage across the blocks is the
  // §5.2 double-count hazard; differing usage is the sharper one, where the
  // earlier block holds a partial count and taking it undercounts the turn.
  expect(shared.some((group) => group.identical)).toBe(true)
  expect(shared.some((group) => !group.identical)).toBe(true)
})

test('the largest counter in a message id group is the whole turn, never the first', () => {
  // The rule ticket 09's parser has to implement: dedup on message.id and
  // take the maximum of each counter across the entries sharing it. Summing
  // double-counts; taking the first undercounts by 200x on the worst case in
  // this corpus.
  const undercounts = corpus.flatMap(({ file, entries }) =>
    assistantsByMessageId(entries)
      .filter((group) => group.length > 1)
      .map((group) =>
        group.map((entry) => entry.message?.usage?.output_tokens ?? 0),
      )
      .filter((counts) => counts[0] !== Math.max(...counts))
      .map(
        (counts) => `${file}: first ${counts[0]} of max ${Math.max(...counts)}`,
      ),
  )

  expect(undercounts.length).toBeGreaterThan(0)
})

test('the corpus contains bookkeeping entries with neither an id nor a timestamp', () => {
  const bookkeeping = corpus.flatMap(({ entries }) =>
    entries.filter((entry) => !('uuid' in entry) && !('timestamp' in entry)),
  )

  expect(new Set(bookkeeping.map((entry) => entry.type))).toContain(
    'last-prompt',
  )
})

test('the corpus contains an agent run and a workflow agent run under a parent session', () => {
  const agentRun = corpus.find(({ file }) => file === 'agent-run.jsonl')!
  const workflowRun = corpus.find(
    ({ file }) => file === 'workflow-agent-run.jsonl',
  )!

  for (const run of [agentRun, workflowRun]) {
    const carries = run.entries.filter(
      (entry) =>
        typeof entry.agentId === 'string' &&
        typeof entry.sessionId === 'string',
    )
    expect(carries.length).toBeGreaterThan(0)
    // The Agent Run's own id and the Session it belongs to are different
    // fields, which is what lets a Turn be attributed to the parent Session.
    expect(new Set(carries.map((entry) => entry.sessionId)).size).toBe(1)
    expect(carries.every((entry) => entry.agentId !== entry.sessionId)).toBe(
      true,
    )
  }
})
