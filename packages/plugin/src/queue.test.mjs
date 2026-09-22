import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { readdir, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from 'vitest'

import { drainQueue, enqueue } from './queue.mjs'

// Ticket 39: the on-disk queue, proven with a fake transport and faked file
// times so no test waits on a real delay.

const stateDir = () => mkdtempSync(join(tmpdir(), 'sessclone-queue-'))

const payload = (n) => ({
  device: { key: 'host:box' },
  reports: [],
  sessionEnd: { sessionId: `s-${n}`, occurredAt: '2026-09-21T10:00:00.000Z' },
})

/** A transport that records what it was handed and answers from a script. */
const transport = (answers) => {
  const seen = []
  const scripted = [...answers]
  const send = async (body) => {
    seen.push(body)
    return scripted.length > 1 ? scripted.shift() : scripted[0]
  }
  return { send, seen }
}

const ok = { ok: true, status: 200 }
const refused = { ok: false, status: 400 }
const unreachable = { ok: false, status: null }
const serverError = { ok: false, status: 503 }

const queueFiles = (dir) =>
  readdirSync(join(dir, 'queue')).filter((name) => name.endsWith('.json'))

test('a queued payload is drained by a later send, oldest first', async () => {
  const dir = stateDir()
  await enqueue(dir, payload(1))
  await enqueue(dir, payload(2))
  expect(queueFiles(dir)).toHaveLength(2)

  const { send, seen } = transport([ok])
  const { drained } = await drainQueue(dir, send)

  expect(drained).toBe(2)
  expect(seen.map((body) => body.sessionEnd.sessionId)).toEqual(['s-1', 's-2'])
  // Both accepted, so both files are gone.
  expect(queueFiles(dir)).toHaveLength(0)
})

test('an unreachable deployment leaves the queue in place, oldest untried again after the break', async () => {
  const dir = stateDir()
  await enqueue(dir, payload(1))
  await enqueue(dir, payload(2))

  // First entry is unreachable: the drain stops there rather than firing the
  // rest at a server that just refused a connection.
  const { send, seen } = transport([unreachable])
  const { drained } = await drainQueue(dir, send)

  expect(drained).toBe(0)
  expect(seen).toHaveLength(1)
  expect(queueFiles(dir)).toHaveLength(2)
})

test('a 5xx also stops the drain and keeps the entry', async () => {
  const dir = stateDir()
  await enqueue(dir, payload(1))

  const { send } = transport([serverError])
  const { drained } = await drainQueue(dir, send)

  expect(drained).toBe(0)
  expect(queueFiles(dir)).toHaveLength(1)
})

test('a refused payload (4xx) is dropped, not retried forever', async () => {
  const dir = stateDir()
  await enqueue(dir, payload(1))
  await enqueue(dir, payload(2))

  // First is refused (malformed / past a limit), second is accepted: a 4xx is
  // discarded like a live report would be, and the drain carries on.
  const { send, seen } = transport([refused, ok])
  const { drained } = await drainQueue(dir, send)

  expect(seen).toHaveLength(2)
  expect(drained).toBe(1) // only the accepted one counts as drained
  expect(queueFiles(dir)).toHaveLength(0) // both files gone
})

test('a corrupt entry is dropped and the drain continues past it', async () => {
  const dir = stateDir()
  await enqueue(dir, payload(1))
  // A half-written file that never got its rename, but with a `.json` name.
  writeFileSync(join(dir, 'queue', '000000000000001-corrupt.json'), '{not json')

  const { send, seen } = transport([ok])
  const { drained } = await drainQueue(dir, send)

  expect(seen).toHaveLength(1) // the corrupt one never reached the transport
  expect(drained).toBe(1)
  expect(queueFiles(dir)).toHaveLength(0)
})

test('drainQueue on an environment that never queued anything is a no-op', async () => {
  const dir = stateDir()
  const { send, seen } = transport([ok])
  const { drained } = await drainQueue(dir, send)
  expect(drained).toBe(0)
  expect(seen).toHaveLength(0)
})

test('entries past the TTL are dropped when the next enqueue enforces the cap', async () => {
  const dir = stateDir()
  await enqueue(dir, payload(1))
  const [old] = await readdir(join(dir, 'queue'))
  // Age the first entry a month by faking its mtime — no test waits 14 days.
  const monthAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000)
  await utimes(join(dir, 'queue', old), monthAgo, monthAgo)

  // The next enqueue runs enforceCap, which drops anything past the TTL.
  await enqueue(dir, payload(2))

  const names = queueFiles(dir)
  expect(names).toHaveLength(1)
  expect(names).not.toContain(old)
})
