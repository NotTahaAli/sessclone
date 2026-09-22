import { mkdtempSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, test, vi } from 'vitest'

import { agentIdOf, archiveTranscript, hashFile } from './archive.mjs'

// Ticket 59. What matters here is the order and the refusals: nothing leaves
// the machine before the deployment says yes, a refusal costs one small
// request and no upload, and a row is only claimed once the confirm succeeded.

afterEach(() => vi.unstubAllGlobals())

const configuration = () => ({
  apiKey: 'sk_' + 'a'.repeat(43),
  url: 'https://collector.test',
  stateDir: mkdtempSync(join(tmpdir(), 'sessclone-archive-state-')),
})

/** A transcript on disk, and its real hash. */
const transcript = async (contents = '{"type":"assistant"}\n') => {
  const path = join(
    mkdtempSync(join(tmpdir(), 'sessclone-archive-')),
    'session-a.jsonl',
  )
  await writeFile(path, contents)
  return path
}

/**
 * A `fetch` double recording every call in order, answering each URL from a
 * script keyed by the path it ends in.
 */
const stubFetch = (answers) => {
  const calls = []
  vi.stubGlobal('fetch', async (url, init) => {
    const target = String(url)
    calls.push({ url: target, method: init.method, init })
    const key = target.includes('/api/logs/presign')
      ? 'presign'
      : target.includes('/api/logs/confirm')
        ? 'confirm'
        : 'put'
    const answer = answers[key]
    if (answer === 'throw') throw new Error('unreachable')
    return {
      ok: answer.ok ?? true,
      status: answer.status ?? 200,
      json: async () => answer.body ?? null,
    }
  })
  return calls
}

const path = (call) => new URL(call.url).pathname

test('the hash is of the bytes on disk, and a missing file is null', async () => {
  const file = await transcript('abc')
  // Compared against the known digest of "abc" rather than against another
  // call of the same function.
  expect(await hashFile(file)).toBe(
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  )
  expect(await hashFile(`${file}.missing`)).toBeNull()
})

test('an Agent Run is keyed by the id in its filename', () => {
  expect(agentIdOf('/x/session-a/subagents/agent-7.jsonl')).toBe('7')
  expect(agentIdOf('/x/session-a.jsonl')).toBeNull()
})

test('an allowed upload is presigned, PUT, then confirmed — in that order', async () => {
  const calls = stubFetch({
    presign: {
      body: { url: 'https://storage.test/object?signed', expiresIn: 300 },
    },
    put: { ok: true },
    confirm: { body: { stored: true, sizeBytes: 21 } },
  })

  const result = await archiveTranscript({
    configuration: configuration(),
    transcriptPath: await transcript(),
    sessionId: 'session-a',
  })

  expect(result).toMatchObject({ archived: true, sizeBytes: 21 })
  expect(calls.map((call) => `${call.method} ${path(call)}`)).toEqual([
    'POST /api/logs/presign',
    'PUT /object',
    'POST /api/logs/confirm',
  ])

  // The key travels in the header on both small requests and in neither body,
  // and never to storage — the presigned URL is the credential there.
  const [presign, put, confirm] = calls
  for (const call of [presign, confirm]) {
    expect(call.init.headers.authorization).toBe(`Bearer sk_${'a'.repeat(43)}`)
    expect(call.init.body).not.toContain('sk_')
  }
  expect(put.init.headers.authorization).toBeUndefined()

  // The hash the confirm records is the one the presign was authorised for.
  expect(JSON.parse(confirm.init.body).sha256).toBe(
    JSON.parse(presign.init.body).sha256,
  )
})

test('a refusal uploads nothing at all', async () => {
  const file = await transcript()
  for (const refused of [
    'archival_off',
    'project_excluded',
    'tier_excludes_archival',
    'unchanged',
    'no_turns',
  ]) {
    const calls = stubFetch({
      presign: { body: { refused, detail: 'no' } },
      put: { ok: true },
      confirm: { body: { stored: true } },
    })

    // eslint-disable-next-line no-await-in-loop -- one refusal at a time, so a failure names which
    const result = await archiveTranscript({
      configuration: configuration(),
      transcriptPath: file,
      sessionId: 'session-a',
    })

    expect(result).toEqual({ archived: false, refused })
    // The whole point: the bytes never moved.
    expect(calls).toHaveLength(1)
  }
})

test('an unreachable deployment archives nothing and says so quietly', async () => {
  const calls = stubFetch({ presign: 'throw' })

  const result = await archiveTranscript({
    configuration: configuration(),
    transcriptPath: await transcript(),
    sessionId: 'session-a',
  })

  expect(result).toEqual({ archived: false, refused: 'unavailable' })
  expect(calls).toHaveLength(1)
})

test('a failed upload is not confirmed', async () => {
  const calls = stubFetch({
    presign: { body: { url: 'https://storage.test/object?signed' } },
    put: { ok: false, status: 403 },
    confirm: { body: { stored: true } },
  })

  const result = await archiveTranscript({
    configuration: configuration(),
    transcriptPath: await transcript(),
    sessionId: 'session-a',
  })

  expect(result).toEqual({ archived: false, refused: 'upload_failed' })
  // No confirm: a row written here would claim a transcript is stored that is
  // not, and the hash guard would then refuse to ever upload it again.
  expect(calls.map(path)).toEqual(['/api/logs/presign', '/object'])
})

test('an upload the confirm did not record is not counted as archived', async () => {
  stubFetch({
    presign: { body: { url: 'https://storage.test/object?signed' } },
    put: { ok: true },
    confirm: { body: { refused: 'not_uploaded', detail: 'nothing there' } },
  })

  const result = await archiveTranscript({
    configuration: configuration(),
    transcriptPath: await transcript(),
    sessionId: 'session-a',
  })

  expect(result).toEqual({ archived: false, refused: 'unconfirmed' })
})
