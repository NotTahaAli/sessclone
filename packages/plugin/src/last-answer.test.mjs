import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, test, vi } from 'vitest'

import { readAnswer, refusalNotice } from './last-answer.mjs'
import { send } from './report.mjs'

// Ticket 98: a refused report used to leave no trace at all — no cursor, no
// queue, not even the state directory — so it looked like no install.

afterEach(() => vi.unstubAllGlobals())

const configuration = () => ({
  apiKey: 'sk_' + 'a'.repeat(43),
  url: 'https://collector.test',
  stateDir: join(mkdtempSync(join(tmpdir(), 'sessclone-answer-')), 'state'),
})

const payload = { device: {}, reports: [] }

test('a refused report leaves its status behind, and the directory with it', async () => {
  vi.stubGlobal('fetch', async () => ({ ok: false, status: 401 }))
  const config = configuration()

  await send({ configuration: config, payload })

  expect(await readAnswer(config.stateDir)).toMatchObject({ status: 401 })
})

test('an unreachable deployment is recorded as no answer', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new Error('ECONNREFUSED')
  })
  const config = configuration()

  await send({ configuration: config, payload })

  expect(await readAnswer(config.stateDir)).toMatchObject({ status: null })
})

test('only a refused key is worth interrupting a session for', () => {
  const at = '2026-09-22T18:00:00.000Z'
  expect(refusalNotice({ status: 401, at })).toContain('(401)')
  expect(refusalNotice({ status: 401, at })).not.toContain('sk_')
  expect(refusalNotice({ status: 200, at })).toBeNull()
  expect(refusalNotice({ status: null, at })).toBeNull()
  expect(refusalNotice(null)).toBeNull()
  // A refusal from before the key was fixed is not repeated.
  expect(
    refusalNotice({ status: 401, at }, new Date('2026-09-22T19:00:00Z')),
  ).toBeNull()
})

test('the hook’s own deadline does not overwrite a real refusal', async () => {
  const config = configuration()
  vi.stubGlobal('fetch', async () => ({ ok: false, status: 401 }))
  await send({ configuration: config, payload })
  vi.stubGlobal('fetch', async () => {
    throw new DOMException('timed out', 'TimeoutError')
  })
  await send({ configuration: config, payload })

  expect(await readAnswer(config.stateDir)).toMatchObject({ status: 401 })
})
