import { mkdtemp } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'

import {
  checkConnection,
  readChecked,
  recordConnection,
  refusedHere,
} from './connection.mjs'
import { send } from './report.mjs'
import { requestSync, takeSyncRequest } from './sync.mjs'

const KEY = `sk_${'a'.repeat(43)}`

/** @type {import('node:http').Server} */
let server
let url = ''
/** @type {string[]} */
const seen = []

beforeAll(async () => {
  // A deployment in miniature: `GET /api/ingest` names the Org for the one
  // live key and answers 401 otherwise, as the route does.
  server = createServer((request, response) => {
    // An old address forwarding to the new one, as sessclone.vercel.app does.
    if (request.url?.startsWith('/moved/')) {
      response.writeHead(301, { location: '/api/ingest' })
      response.end()
      return
    }
    seen.push(request.headers.authorization ?? '(none)')
    const live = request.headers.authorization === `Bearer ${KEY}`
    response.writeHead(live ? 200 : 401, { 'content-type': 'application/json' })
    response.end(JSON.stringify(live ? { org: 'Acme' } : { error: 'no' }))
  })
  await new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve(null)),
  )
  const address = server.address()
  if (address === null || typeof address === 'string')
    throw new Error('no port')
  url = `http://127.0.0.1:${address.port}`
})

afterAll(() => new Promise((resolve) => server.close(() => resolve(null))))

const configuration = async (apiKey) => ({
  apiKey,
  url,
  stateDir: await mkdtemp(join(tmpdir(), 'connection-')),
  device: undefined,
})

test('a live key is connected, and says so once', async () => {
  const config = await configuration(KEY)
  const connection = await checkConnection(config)

  expect(connection).toEqual({ state: 'connected', org: 'Acme' })
  expect(await recordConnection(config, connection)).toBe(
    'sessclone connected: reporting to Acme.',
  )
  expect(await recordConnection(config, connection)).toBeNull()
})

test('what status reads carries the key only as its prefix and length', async () => {
  const config = await configuration(KEY)
  await recordConnection(config, await checkConnection(config))

  const checked = await readChecked(config.stateDir)
  expect(checked).toMatchObject({
    state: 'connected',
    org: 'Acme',
    url,
    key: { prefix: 'sk_', length: 46 },
  })
  expect(JSON.stringify(checked)).not.toContain(KEY)
})

test('no key sends no header, and is told it is not connected every time', async () => {
  // In a cloud environment the proxy adds the header; here nothing does.
  const config = await configuration(undefined)
  const connection = await checkConnection(config)

  expect(seen.at(-1)).toBe('(none)')
  expect(connection).toEqual({ state: 'refused' })
  for (let session = 0; session < 2; session++) {
    // eslint-disable-next-line no-await-in-loop -- one session after another
    expect(await recordConnection(config, connection)).toContain(
      'no API key is set',
    )
  }
})

test('a refused key sends nothing more, until a new key is connected', async () => {
  // Without this, each turn re-sends the session's whole unsent history, its
  // paths and branches included, to a deployment that already said no.
  const config = await configuration(`sk_${'b'.repeat(43)}`)
  await recordConnection(config, await checkConnection(config))
  const before = seen.length

  expect(await refusedHere(config)).toBe(true)
  expect(
    await send({
      configuration: config,
      payload: { device: { key: 'host:laptop' }, reports: [] },
    }),
  ).toEqual({
    ok: false,
    status: 401,
  })
  expect(seen.length).toBe(before)

  // A different key is a different question, not bound by the old answer.
  expect(await refusedHere({ ...config, apiKey: KEY })).toBe(false)
  const fixed = { ...config, apiKey: KEY }
  expect(await recordConnection(fixed, await checkConnection(fixed))).toContain(
    'connected',
  )
  expect(await refusedHere(fixed)).toBe(false)
})

test('an unreachable or older deployment says nothing about the key', async () => {
  const config = await configuration(KEY)
  const connection = await checkConnection({
    ...config,
    url: 'http://127.0.0.1:9',
  })

  expect(connection).toEqual({ state: 'unknown', status: null })
  expect(await recordConnection(config, connection)).toBeNull()
  expect(
    await recordConnection(config, { state: 'unknown', status: 405 }),
  ).toBeNull()
  expect(await readChecked(config.stateDir)).toBeNull()
})

test('a sync request is taken once', async () => {
  const { stateDir } = await configuration(KEY)

  expect(await takeSyncRequest(stateDir)).toBe(false)
  await requestSync(stateDir)
  expect(await takeSyncRequest(stateDir)).toBe(true)
  expect(await takeSyncRequest(stateDir)).toBe(false)
})

test('a report to an address that redirects is not taken as delivered', async () => {
  // Followed, the 301 turns the POST into the key check's GET, which answers
  // 200 and files nothing; the cursor would move past Turns never stored.
  const config = { ...(await configuration(KEY)), url: `${url}/moved` }
  const answer = await send({ configuration: config, payload: {} })
  expect(answer).toEqual({ ok: false, status: 301 })
})
