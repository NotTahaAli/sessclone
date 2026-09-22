import { mkdtempSync } from 'node:fs'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, test, vi } from 'vitest'

import { deliver, sweep } from './report.mjs'
import { enqueue } from './queue.mjs'

// Ticket 39: retry-then-queue and the SessionStart sweep, proven with a faked
// transport, an injected sleep and a faked clock — no test waits on a delay.

afterEach(() => vi.unstubAllGlobals())

const configuration = () => ({
  apiKey: 'sk_' + 'a'.repeat(43),
  url: 'https://collector.test',
  stateDir: mkdtempSync(join(tmpdir(), 'sessclone-sweep-state-')),
})

/**
 * A `fetch` double: answers from a script and records each reported body.
 *
 * Archival (ticket 59) rides the same sweep, and this file is about Turns, so
 * the archival requests are answered as a Member who has not opted in — which
 * is the default state — and are not recorded. `archive.test.mjs` is where
 * that path is proven.
 */
const stubFetch = (answers) => {
  const bodies = []
  const scripted = [...answers]
  vi.stubGlobal('fetch', async (url, init) => {
    if (String(url).includes('/api/logs/')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          refused: 'archival_off',
          detail: 'archival is off for this membership',
        }),
      }
    }
    bodies.push(JSON.parse(init.body))
    const answer = scripted.length > 1 ? scripted.shift() : scripted[0]
    if (answer === 'throw') throw new Error('unreachable')
    return { ok: answer.ok, status: answer.status }
  })
  return bodies
}

const assistant = (sessionId, messageId) => ({
  type: 'assistant',
  uuid: `uuid-${messageId}`,
  sessionId,
  cwd: '/home/dev/api',
  timestamp: '2026-09-21T10:00:00.000Z',
  message: {
    id: messageId,
    model: 'claude-opus-4-6',
    usage: {
      input_tokens: 3,
      output_tokens: 12,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  },
})

/** A config directory with one project holding the named sessions' transcripts. */
const configDir = async (sessions) => {
  const dir = mkdtempSync(join(tmpdir(), 'sessclone-sweep-config-'))
  const project = join(dir, 'projects', 'home-dev-api')
  await mkdir(project, { recursive: true })
  await Promise.all(
    Object.entries(sessions).map(([sessionId, lines]) =>
      writeFile(
        join(project, `${sessionId}.jsonl`),
        // Newline-terminated, as an append-only transcript is: the last line's
        // newline is what lets a cursor land past it (see `readFrom`).
        lines.map((line) => JSON.stringify(line) + '\n').join(''),
      ),
    ),
  )
  return dir
}

test('deliver retries a transient failure then succeeds, without queuing', async () => {
  const bodies = stubFetch([
    { ok: false, status: null },
    { ok: false, status: null },
    { ok: true, status: 200 },
  ])
  const slept = []
  const result = await deliver({
    configuration: configuration(),
    payload: { device: { key: 'host:box' }, reports: [] },
    sleep: async (ms) => void slept.push(ms),
  })

  expect(result).toEqual({ ok: true, status: 200, queued: false })
  expect(bodies).toHaveLength(3)
  expect(slept).toEqual([100, 500]) // backed off before the 2nd and 3rd try
})

test('deliver queues a payload that is still unreachable after every retry', async () => {
  const config = configuration()
  stubFetch([{ ok: false, status: null }])
  const result = await deliver({
    configuration: config,
    payload: {
      device: { key: 'host:box' },
      reports: [],
      sessionEnd: { sessionId: 's-1', occurredAt: '2026-09-21T10:00:00.000Z' },
    },
    sleep: async () => {},
  })

  expect(result.queued).toBe(true)
  const queued = await readdir(join(config.stateDir, 'queue'))
  expect(queued).toHaveLength(1)
})

test('deliver treats a 4xx as final: no retry, no queue', async () => {
  const config = configuration()
  const bodies = stubFetch([{ ok: false, status: 400 }])
  const result = await deliver({
    configuration: config,
    payload: { device: { key: 'host:box' }, reports: [] },
    sleep: async () => {
      throw new Error('must not sleep on a 4xx')
    },
  })

  expect(result).toEqual({ ok: false, status: 400, queued: false })
  expect(bodies).toHaveLength(1)
  await expect(readdir(join(config.stateDir, 'queue'))).rejects.toThrow() // never created
})

test('the sweep drains the queue first, then reports each session from the top', async () => {
  const config = configuration()
  // A marker left behind by an earlier session that could not push.
  await enqueue(config.stateDir, {
    device: { key: 'host:box' },
    reports: [],
    sessionEnd: {
      sessionId: 'earlier',
      occurredAt: '2026-09-21T09:00:00.000Z',
    },
  })
  const dir = await configDir({
    'session-a': [assistant('session-a', 'a1'), assistant('session-a', 'a2')],
    'session-b': [assistant('session-b', 'b1')],
  })

  const bodies = stubFetch([{ ok: true, status: 200 }])
  await sweep({
    configuration: config,
    environment: { CLAUDE_CONFIG_DIR: dir },
  })

  // The queued marker went first.
  expect(bodies[0].sessionEnd.sessionId).toBe('earlier')
  // Then both sessions, each with its Turns (no cursor: read from the top).
  const reported = bodies.flatMap((body) =>
    body.reports.map((report) => report.sessionId),
  )
  expect(new Set(reported)).toEqual(new Set(['session-a', 'session-b']))
  const queued = await readdir(join(config.stateDir, 'queue'))
  expect(queued).toHaveLength(0) // the drain cleared it
})

test('a session already flushed to its end is not re-reported by the next sweep', async () => {
  const config = configuration()
  const dir = await configDir({
    'session-a': [assistant('session-a', 'a1')],
  })

  stubFetch([{ ok: true, status: 200 }])
  await sweep({
    configuration: config,
    environment: { CLAUDE_CONFIG_DIR: dir },
  })

  // Second sweep: the cursor is at the end, so nothing is sent.
  const bodies = stubFetch([{ ok: true, status: 200 }])
  await sweep({
    configuration: config,
    environment: { CLAUDE_CONFIG_DIR: dir },
  })
  expect(bodies).toHaveLength(0)
})

test('the sweep stops when its time budget is spent', async () => {
  const config = configuration()
  const dir = await configDir({
    'session-a': [assistant('session-a', 'a1')],
    'session-b': [assistant('session-b', 'b1')],
  })

  const bodies = stubFetch([{ ok: true, status: 200 }])
  // A clock already past the deadline before the first session: the loop breaks
  // immediately, so no session is flushed (the queue drain still ran).
  let tick = 0
  await sweep({
    configuration: config,
    environment: { CLAUDE_CONFIG_DIR: dir },
    now: () => (tick++ === 0 ? 0 : 999999),
    budgetMs: 8000,
  })

  expect(bodies).toHaveLength(0)
})
