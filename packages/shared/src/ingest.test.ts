import { readFileSync } from 'node:fs'

import { expect, test } from 'vitest'

import { IngestPayload, type ReportedTurn } from './ingest.ts'
import { parseTranscript, type Turn } from './turns.ts'

// Ticket 31. The wire contract lives here rather than in the route, because
// the Collector sends what this schema describes and the route refuses
// anything else — one definition, imported by both, so a payload change is a
// build failure instead of a production one.

const FIXTURES = new URL('../fixtures/transcripts/', import.meta.url)

const turnsOf = (file: string) =>
  parseTranscript(readFileSync(new URL(file, FIXTURES), 'utf8'))

const payload = (turns: readonly ReportedTurn[]) => ({
  device: { key: 'host:build-box' },
  reports: [
    {
      sessionId: turns[0]!.sessionId,
      agentId: turns[0]!.agentId,
      project: {
        key: 'github.com/acme/api',
        remote: 'git@github.com:acme/api.git',
      },
      cursor: { messageId: turns.at(-1)!.messageId, byteOffset: 4096 },
      turns,
    },
  ],
})

test('accepts what the parser produces', () => {
  const turns = turnsOf('multi-iteration-turn.jsonl')
  expect(turns.length).toBeGreaterThan(0)

  // The parser's Turn *is* the reported turn: this assignment is the contract,
  // checked by `tsc` rather than only at runtime.
  const reported: ReportedTurn[] = turns satisfies Turn[]

  expect(IngestPayload.safeParse(payload(reported)).success).toBe(true)
})

test('refuses a turn with no message id', () => {
  const [turn] = turnsOf('multi-iteration-turn.jsonl')
  const broken = payload([{ ...turn!, messageId: '' }])

  expect(IngestPayload.safeParse(broken).success).toBe(false)
})

test('refuses a negative counter', () => {
  const [turn] = turnsOf('multi-iteration-turn.jsonl')
  const broken = payload([
    { ...turn!, usage: { ...turn!.usage, outputTokens: -1 } },
  ])

  expect(IngestPayload.safeParse(broken).success).toBe(false)
})

test('names no member, because the key names one (ticket 34)', () => {
  // The Member and the Org come from the API key in the `Authorization`
  // header, so a payload that asserts one is asserting something the route
  // does not read. An extra key is ignored rather than refused — zod strips
  // what the schema does not declare — and what matters is that it reaches
  // nothing: a payload carrying somebody else's id parses to a payload
  // carrying no id at all.
  const turns = turnsOf('multi-iteration-turn.jsonl')
  const parsed = IngestPayload.parse({
    ...payload(turns),
    memberId: '00000000-0000-4000-8000-00000000dead',
  })

  expect(parsed).not.toHaveProperty('memberId')
})

test('refuses a report with no cursor to acknowledge', () => {
  const turns = turnsOf('multi-iteration-turn.jsonl')
  const report = payload(turns).reports[0]!

  expect(
    IngestPayload.safeParse({
      ...payload(turns),
      reports: [{ ...report, cursor: undefined }],
    }).success,
  ).toBe(false)
})

test('an empty agent id is absence spelled differently, and is refused', () => {
  const [turn] = turnsOf('agent-run.jsonl')

  expect(
    IngestPayload.safeParse(payload([{ ...turn!, agentId: '' }])).success,
  ).toBe(false)
})

test('a whitespace-only session id is refused, as the table would refuse it', () => {
  const [turn] = turnsOf('multi-iteration-turn.jsonl')
  const body = payload([{ ...turn!, sessionId: '   ' }])
  body.reports[0]!.sessionId = '   '

  expect(IngestPayload.safeParse(body).success).toBe(false)
})

test('a whitespace-only message id, agent id or key is refused too', () => {
  const [turn] = turnsOf('multi-iteration-turn.jsonl')

  expect(
    IngestPayload.safeParse(payload([{ ...turn!, messageId: ' ' }])).success,
  ).toBe(false)
  expect(
    IngestPayload.safeParse(payload([{ ...turn!, agentId: '\t' }])).success,
  ).toBe(false)

  const blankProject = payload([turn!])
  blankProject.reports[0]!.project.key = '  '
  expect(IngestPayload.safeParse(blankProject).success).toBe(false)

  const blankDevice = payload([turn!])
  blankDevice.device.key = '  '
  expect(IngestPayload.safeParse(blankDevice).success).toBe(false)
})

test('a batch past the documented limits is refused, and says which', () => {
  const [turn] = turnsOf('multi-iteration-turn.jsonl')

  const tooManyTurns = IngestPayload.safeParse(
    payload(Array.from({ length: 5001 }, () => turn!)),
  )
  expect(tooManyTurns.success).toBe(false)
  expect(tooManyTurns.error?.issues[0]?.message).toMatch(/5000/)

  const one = payload([turn!])
  const tooManyReports = IngestPayload.safeParse({
    ...one,
    reports: Array.from({ length: 101 }, () => one.reports[0]!),
  })
  expect(tooManyReports.success).toBe(false)
  expect(tooManyReports.error?.issues[0]?.message).toMatch(/100/)
})

// Tickets 40 and 38: the session-event side of the wire, tested where the
// bounds live rather than only through a Postgres route.

const failure = (over: Record<string, unknown> = {}) => ({
  sessionId: 'session-1',
  occurredAt: '2026-09-21T11:00:00.000Z',
  errorType: 'rate_limit',
  message: 'x',
  ...over,
})

const failurePayload = (over: Record<string, unknown> = {}) => ({
  device: { key: 'host:build-box' },
  reports: [],
  failures: [failure()],
  ...over,
})

test('a stop failure with a type and a session id parses', () => {
  expect(IngestPayload.safeParse(failurePayload()).success).toBe(true)
})

test('a blank error type is refused', () => {
  expect(
    IngestPayload.safeParse(
      failurePayload({ failures: [failure({ errorType: '   ' })] }),
    ).success,
  ).toBe(false)
  expect(
    IngestPayload.safeParse(
      failurePayload({ failures: [failure({ errorType: '' })] }),
    ).success,
  ).toBe(false)
})

test('an error type or message past its bound is refused', () => {
  expect(
    IngestPayload.safeParse(
      failurePayload({ failures: [failure({ errorType: 'x'.repeat(65) })] }),
    ).success,
  ).toBe(false)
  expect(
    IngestPayload.safeParse(
      failurePayload({ failures: [failure({ message: 'x'.repeat(2001) })] }),
    ).success,
  ).toBe(false)
})

test('more than 100 failures in one batch is refused', () => {
  const many = failurePayload({
    failures: Array.from({ length: 101 }, () => failure()),
  })
  expect(IngestPayload.safeParse(many).success).toBe(false)
})

test('a batch carrying neither a report, a failure nor a session end is refused', () => {
  const empty = IngestPayload.safeParse({
    device: { key: 'host:build-box' },
    reports: [],
  })
  expect(empty.success).toBe(false)
})

test('a bare session-end marker is a valid batch', () => {
  const parsed = IngestPayload.safeParse({
    device: { key: 'host:build-box' },
    reports: [],
    sessionEnd: {
      sessionId: 'session-1',
      occurredAt: '2026-09-21T12:00:00.000Z',
    },
  })
  expect(parsed.success).toBe(true)
})
