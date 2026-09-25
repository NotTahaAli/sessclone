import { buildTimeline, parseLines, splitChunk } from '@sessclone/shared'
import { expect, test } from 'vitest'

import {
  DEMO_DAYS,
  DEMO_ORGS,
  demoCutoff,
  demoDay,
  demoOrg,
  demoTranscript,
  demoWindow,
  TRANSCRIPT_EVERY,
} from '../lib/demo-data'
import { DEMO_USER_ID } from '../lib/demo'

// Ticket 137: the demo's generator. Pure, so every rule is proven here and
// the database tests only prove what the database adds.

const [owned, joined] = DEMO_ORGS.map((spec) => demoOrg(spec, DEMO_USER_ID))

test('the same Org and day always generate the same data', () => {
  expect(demoOrg(DEMO_ORGS[0]!, DEMO_USER_ID)).toEqual(owned)
  expect(demoDay(owned!, '2026-09-22')).toEqual(demoDay(owned!, '2026-09-22'))
  expect(demoDay(owned!, '2026-09-22')).not.toEqual(
    demoDay(owned!, '2026-09-23'),
  )
})

const byText = (a: string, b: string) => a.localeCompare(b)

const names = (org: typeof owned) =>
  org!.team.filter((p) => !p.visitor).map((p) => p.name)

test('each Org has its own team of six with the visitor in it', () => {
  for (const org of [owned!, joined!]) {
    expect(org.team).toHaveLength(6)
    expect(org.team.filter((person) => person.visitor)).toHaveLength(1)
    expect(org.team.filter((person) => person.role === 'owner')).toHaveLength(1)
  }
  expect(owned!.team.find((p) => p.visitor)!.role).toBe('owner')
  expect(joined!.team.find((p) => p.visitor)!.role).toBe('member')
  // Different people, Projects and models.
  expect(names(owned)).not.toEqual(names(joined))
  expect(owned!.projects.map((p) => p.key)).not.toEqual(
    joined!.projects.map((p) => p.key),
  )
  expect(new Set(owned!.team.map((p) => p.memberId)).size).toBe(6)
})

test('volumes look like a real team: busy weekdays, quiet weekends, plausible spend', () => {
  const weekday = demoDay(owned!, '2026-09-23') // a Wednesday
  const weekend = demoDay(owned!, '2026-09-26') // a Saturday
  const turns = weekday.flatMap((session) => session.turns)

  expect(weekday.length).toBeGreaterThanOrEqual(4)
  expect(weekday.length).toBeLessThanOrEqual(30)
  expect(weekend.length).toBeLessThan(weekday.length)
  expect(turns.length).toBeGreaterThan(50)
  expect(turns.length).toBeLessThan(2_000)
  // The visitor works every weekday, so both of their views have data.
  expect(weekday.some((s) => s.memberId === owned!.team[0]!.memberId)).toBe(
    true,
  )
  // A few Agent Runs, on a cheaper model, one level down.
  const days = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24'].flatMap(
    (day) => demoDay(owned!, day),
  )
  const agents = days.flatMap((s) => s.turns).filter((t) => t.agentId)
  expect(agents.length).toBeGreaterThan(0)
  expect(agents.every((t) => t.spawnDepth === 1)).toBe(true)

  // Tokens a Claude Code Turn actually reports: cached context dominates.
  for (const turn of turns) {
    expect(turn.outputTokens).toBeGreaterThan(0)
    expect(turn.cacheReadInputTokens).toBeLessThanOrEqual(200_000)
    expect(turn.occurredAt.getUTCHours()).toBeLessThan(23)
    expect(turn.occurredAt.toISOString().slice(0, 10)).toBe('2026-09-23')
  }
  // Every model is one the rate seed prices.
  const models = new Set(days.flatMap((s) => s.turns).map((t) => t.model))
  for (const model of models) expect(model).toMatch(/^claude-/)
})

test('the window is the last 60 UTC days, today once its activity has ended', () => {
  const morning = new Date('2026-09-25T10:00:00Z')
  const night = new Date('2026-09-25T23:10:00Z')

  expect(demoWindow(morning)).toHaveLength(DEMO_DAYS - 1)
  expect(demoWindow(morning).at(-1)).toBe('2026-09-24')
  expect(demoWindow(night)).toHaveLength(DEMO_DAYS)
  expect(demoWindow(night).at(-1)).toBe('2026-09-25')
  expect(demoWindow(night)[0]).toBe('2026-07-28')
})

test('the cutoff is the start of the window’s first day', () => {
  expect(demoCutoff(new Date('2026-09-25T23:10:00Z')).toISOString()).toBe(
    '2026-07-28T00:00:00.000Z',
  )
  // A day later, one more day falls out.
  expect(demoCutoff(new Date('2026-09-26T00:10:00Z')).toISOString()).toBe(
    '2026-07-29T00:00:00.000Z',
  )
})

test('a stored transcript is small, parses, and joins to its Turns', () => {
  const window = demoWindow(new Date('2026-09-25T23:10:00Z'))
  const stored = window
    .flatMap((day) => demoDay(owned!, day))
    .filter((session) => session.transcript)

  // About one every TRANSCRIPT_EVERY days: small enough to keep storage in
  // the hundreds of kilobytes across both Orgs.
  expect(stored.length).toBeGreaterThan(DEMO_DAYS / TRANSCRIPT_EVERY / 2)
  expect(stored.length).toBeLessThanOrEqual(DEMO_DAYS / TRANSCRIPT_EVERY + 1)

  const session = stored[0]!
  const jsonl = demoTranscript(session)
  // Both Orgs' transcripts together stay in the hundreds of kilobytes.
  const total = [owned!, joined!]
    .flatMap((org) => window.flatMap((day) => demoDay(org, day)))
    .filter((s) => s.transcript)
    .reduce((sum, s) => sum + Buffer.byteLength(demoTranscript(s)), 0)
  expect(total).toBeLessThan(500_000)
  expect(demoTranscript(session)).toBe(jsonl)

  const { lines } = splitChunk(new TextEncoder().encode(jsonl), 0, {
    atFileStart: true,
    atFileEnd: true,
  })
  const items = parseLines(lines)
  expect(items.some((item) => item.kind === 'unknown')).toBe(false)
  const ids = new Set(
    items.flatMap((item) =>
      item.kind === 'assistant' ? [item.messageId] : [],
    ),
  )
  const toolIds = items.flatMap((item) =>
    item.kind === 'tool_use' ? [item.messageId] : [],
  )
  for (const id of toolIds) ids.add(id)
  expect(
    [...ids].filter((id): id is string => id !== null).toSorted(byText),
  ).toEqual(session.turns.map((turn) => turn.messageId).toSorted(byText))
  expect(buildTimeline(items).length).toBeGreaterThan(0)
  // Nothing that looks like a key or a token.
  expect(jsonl).not.toMatch(/sk[_-][a-z0-9]{8}|AKIA|password|BEGIN [A-Z]+ KEY/i)
})

test('every Org has a Session on every day, weekends included', () => {
  // The refresh counts a day as seeded when it has a Turn: an empty day would
  // be generated again on every run, forever. Two years, so every weekday
  // and weekend meets every seed a few times.
  const days = Array.from({ length: 730 }, (_, back) =>
    new Date(Date.UTC(2026, 8, 25) - back * 86_400_000)
      .toISOString()
      .slice(0, 10),
  )
  for (const org of [owned!, joined!]) {
    const empty = days.filter((day) => demoDay(org, day).length === 0)
    expect(empty).toEqual([])
  }
})
