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
  apiBlockIndex?: number
  uuid?: string
  timestamp?: string
  agentId?: string
  sessionId?: string
  message?: {
    id?: string
    stop_reason?: string | null
    usage?: { output_tokens?: number }
  }
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
    // Keys as well as values. A map keyed by a path, a branch or an
    // environment variable name would otherwise walk straight past a guard
    // that only ever looked at what the keys pointed to.
    return Object.entries(value).flatMap(([key, nested]) => [
      key,
      ...everyString(nested),
    ])
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

test('apiBlockIndex 0 is the partial write, not the entry to price from', () => {
  // The v1 spec said to take `apiBlockIndex` 0 and that the blocks carry
  // identical Usage. Both are false, and this is the evidence: block 0 is
  // written while the response is still streaming. Pricing off it returns 1
  // output token for a 202-token turn.
  const undercounted = corpus.flatMap(({ file, entries }) =>
    assistantsByMessageId(entries)
      .filter((group) => group.length > 1)
      .map((group) => ({
        file,
        first: group.find((entry) => entry.apiBlockIndex === 0)?.message?.usage
          ?.output_tokens,
        most: Math.max(
          ...group.map((entry) => entry.message?.usage?.output_tokens ?? 0),
        ),
      }))
      .filter(({ first, most }) => first !== undefined && first < most),
  )

  expect(undercounted.length).toBeGreaterThan(0)
})

test('a turn that never finished is a floor, not a total', () => {
  // Every entry of the group carries `stop_reason: null`, so the maximum is
  // whatever had streamed when the run died. `agent-run-ends-mid-turn.jsonl`
  // is that shape on purpose; ticket 09 has to tell it apart from a complete
  // turn rather than bill it as one.
  const unfinished = corpus.flatMap(({ file, entries }) =>
    assistantsByMessageId(entries)
      .filter((group) =>
        group.every((entry) => entry.message?.stop_reason === null),
      )
      .map(() => file),
  )

  expect(unfinished).toContain('agent-run-ends-mid-turn.jsonl')
})

test('the corpus contains bookkeeping entries with neither an id nor a timestamp', () => {
  const bookkeeping = corpus.flatMap(({ entries }) =>
    entries.filter((entry) => !('uuid' in entry) && !('timestamp' in entry)),
  )

  expect(new Set(bookkeeping.map((entry) => entry.type))).toContain(
    'last-prompt',
  )
})

test('an agent run is attributed to the session that spawned it', () => {
  const runs = [
    'agent-run.jsonl',
    'agent-run-ends-mid-turn.jsonl',
    'workflow-agent-run.jsonl',
  ]

  const sessions = runs.map((file) => {
    const entries = corpus.find((entry) => entry.file === file)!.entries
    const carries = entries.filter((entry) => typeof entry.agentId === 'string')
    expect(carries.length).toBeGreaterThan(0)
    return new Set(carries.map((entry) => entry.sessionId))
  })

  // Each Agent Run reports one Session, and it is the Session of the ordinary
  // transcript that spawned it — which is what lets a Turn from an Agent Run
  // be attributed to the parent Session rather than stranded under its own id.
  const parent = corpus.find(
    (entry) => entry.file === 'nested-run-inherits-parent-session-id.jsonl',
  )!.entries[0]!.sessionId

  for (const session of sessions) {
    expect(session.size).toBe(1)
    expect([...session]).toEqual([parent])
  }
})

// Ticket 75. Claude Projects runs the same CLI in a container it builds per
// session, so the question is not whether it writes transcripts but whether it
// writes the same ones. These two assertions are what would fail if that ever
// stopped being true.
const PROJECTS = 'projects-thread-session.jsonl'

test('a Projects session splits one response across several usage entries', () => {
  const entries = corpus.find((entry) => entry.file === PROJECTS)!.entries
  const usage = entries.filter((entry) => entry.message?.usage)
  const ids = new Set(usage.map((entry) => entry.message!.id))

  // The overcount ADR 0006 exists for, measured in a live Projects session:
  // three usage-bearing entries per response, split by apiBlockIndex. A parser
  // keying on the entry rather than the response bills three times here.
  expect(usage.length).toBe(9)
  expect(ids.size).toBe(3)
  expect(new Set(usage.map((entry) => entry.apiBlockIndex))).toEqual(
    new Set([0, 1, 2]),
  )
})

test('a Projects session carries fields the other fixtures do not', () => {
  const keysIn = (file: string) =>
    new Set(
      corpus
        .find((entry) => entry.file === file)!
        .entries.flatMap((entry) => Object.keys(entry)),
    )

  const projectsOnly = [...keysIn(PROJECTS)].filter(
    (key) => !keysIn('resume-appends-to-one-file.jsonl').has(key),
  )

  // Not an exhaustive list — the point is that they are here, redacted to
  // placeholders but present, so a parser that chokes on an unknown entry
  // field fails against this fixture rather than in production.
  expect(projectsOnly).toEqual(
    expect.arrayContaining(['projectsUserTurn', 'turnOrigin', 'advisorModel']),
  )
})
