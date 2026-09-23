import { mkdtempSync } from 'node:fs'
import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, test, vi } from 'vitest'

import {
  archiveAfterTurn,
  archivesEveryTurn,
  agentIdOf,
  archiveSession,
  archiveTranscript,
  hashFile,
} from './archive.mjs'

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

test('the hash is of the range asked for, and a missing file is null', async () => {
  const file = await transcript('abcdef')
  // The known digest of "abc" rather than another call of the same function:
  // the bound is what makes the upload's content-length honest, so it is
  // asserted against a value from outside this code.
  expect(await hashFile(file, 3)).toBe(
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  )
  expect(await hashFile(`${file}.missing`, 3)).toBeNull()
})

test('an Agent Run is keyed by the id in its filename', () => {
  expect(agentIdOf('/x/session-a/subagents/agent-7.jsonl')).toBe('7')
  expect(agentIdOf('/x/session-a.jsonl')).toBeNull()
})

test('an allowed upload is presigned, PUT, then confirmed — in that order', async () => {
  const calls = stubFetch({
    presign: {
      body: {
        url: 'https://storage.test/object?signed',
        storageKey: 'orgs/o/members/m/projects/p/session-a.jsonl',
        expiresIn: 300,
      },
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

  // The hash the confirm records is the one the presign was authorised for,
  // and the key it echoes is the one the bytes went to — which is what lets
  // the deployment refuse a Session that moved Project in between.
  expect(JSON.parse(confirm.init.body)).toMatchObject({
    sha256: JSON.parse(presign.init.body).sha256,
    storageKey: 'orgs/o/members/m/projects/p/session-a.jsonl',
  })

  // The body is a stream, not the file read into memory, and the declared
  // length is the file's own.
  expect(put.init.body).toBeInstanceOf(ReadableStream)
  expect(put.init.headers['content-length']).toBe('21')
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
    presign: {
      body: { url: 'https://storage.test/object?signed', storageKey: 'k' },
    },
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
    presign: {
      body: { url: 'https://storage.test/object?signed', storageKey: 'k' },
    },
    put: { ok: true },
    confirm: { body: { refused: 'not_uploaded', detail: 'nothing there' } },
  })

  const result = await archiveTranscript({
    configuration: configuration(),
    transcriptPath: await transcript(),
    sessionId: 'session-a',
  })

  // The route's own refusal, carried through rather than flattened: it is
  // transient, and a status surface has to be able to say which it was.
  expect(result).toEqual({ archived: false, refused: 'not_uploaded' })
})

test('a transcript that grows between the hash and the PUT is still consistent', async () => {
  // A session another process is appending to right now: the size is taken
  // once and both the hash and the upload read that range, so the request
  // cannot declare one length and send another — which fails the PUT *after*
  // the bytes have gone.
  const file = await transcript('{"a":1}\n')
  const calls = stubFetch({
    presign: {
      body: { url: 'https://storage.test/object?signed', storageKey: 'k' },
    },
    put: { ok: true },
    confirm: { body: { stored: true, sizeBytes: 8 } },
  })

  vi.stubGlobal('fetch', async (url, init) => {
    // Grow the file at the moment the PUT is being made.
    if (String(url).includes('storage.test')) {
      await appendFile(file, '{"b":2}\n')
      const sent = await new Response(init.body).arrayBuffer()
      calls.push({
        url: String(url),
        method: init.method,
        init,
        sent: sent.byteLength,
      })
      return { ok: true, status: 200, json: async () => null }
    }
    calls.push({ url: String(url), method: init.method, init })
    return {
      ok: true,
      status: 200,
      json: async () =>
        String(url).includes('presign')
          ? { url: 'https://storage.test/object?signed', storageKey: 'k' }
          : { stored: true, sizeBytes: 8 },
    }
  })

  const result = await archiveTranscript({
    configuration: configuration(),
    transcriptPath: file,
    sessionId: 'session-a',
  })

  expect(result.archived).toBe(true)
  const put = calls.find((call) => call.method === 'PUT')
  expect(put.sent).toBe(8)
  expect(put.init.headers['content-length']).toBe('8')
})

test('a settled outcome is not paid for twice while the file is unchanged', async () => {
  const config = configuration()
  const file = await transcript()

  const first = stubFetch({ presign: { body: { refused: 'archival_off' } } })
  await archiveTranscript({
    configuration: config,
    transcriptPath: file,
    sessionId: 'session-a',
  })
  expect(first).toHaveLength(1)

  // Nothing about the file changed and no switch here can change the answer,
  // so the second pass costs neither a read nor a request. This is what keeps
  // a sweep over a year of transcripts from re-hashing all of them.
  const again = stubFetch({ presign: { body: { refused: 'archival_off' } } })
  const result = await archiveTranscript({
    configuration: config,
    transcriptPath: file,
    sessionId: 'session-a',
  })
  expect(again).toHaveLength(0)
  expect(result).toMatchObject({ archived: false, refused: 'archival_off' })

  // A transcript that grew is asked about again.
  await appendFile(file, '{"more":1}\n')
  const third = stubFetch({ presign: { body: { refused: 'archival_off' } } })
  await archiveTranscript({
    configuration: config,
    transcriptPath: file,
    sessionId: 'session-a',
  })
  expect(third).toHaveLength(1)
})

test('a transient refusal is retried rather than remembered', async () => {
  const config = configuration()
  const file = await transcript()

  stubFetch({ presign: { body: { refused: 'no_turns' } } })
  await archiveTranscript({
    configuration: config,
    transcriptPath: file,
    sessionId: 'session-a',
  })

  // The Session simply has not been ingested yet; the next pass asks again.
  const again = stubFetch({ presign: { body: { refused: 'no_turns' } } })
  await archiveTranscript({
    configuration: config,
    transcriptPath: file,
    sessionId: 'session-a',
  })
  expect(again).toHaveLength(1)
})

test('each of a Session’s transcripts is archived under its own id', async () => {
  const config = configuration()
  const dir = mkdtempSync(join(tmpdir(), 'sessclone-archive-config-'))
  const project = join(dir, 'projects', 'home-dev-api')
  const runs = join(project, 'session-a', 'subagents')
  await mkdir(runs, { recursive: true })
  await writeFile(join(project, 'session-a.jsonl'), '{"main":1}\n')
  await writeFile(join(runs, 'agent-7.jsonl'), '{"run":1}\n')
  // A file under `subagents/` whose name carries no id: it must be skipped,
  // not filed under the Session's own key, which would replace the Session's
  // own transcript with it.
  await writeFile(join(runs, 'notes.jsonl'), '{"stray":1}\n')

  const calls = stubFetch({
    presign: { body: { refused: 'archival_off' } },
  })

  const { archived } = await archiveSession({
    configuration: config,
    transcriptPath: join(project, 'session-a.jsonl'),
    sessionId: 'session-a',
    environment: { CLAUDE_CONFIG_DIR: dir },
  })

  expect(archived).toBe(0)
  const asked = calls.map((call) => JSON.parse(call.init.body).agentId)
  expect(asked.toSorted((a, b) => String(a).localeCompare(String(b)))).toEqual([
    '7',
    null,
  ])
})

test('the session archive sends nothing once its deadline has passed', async () => {
  const config = configuration()
  const dir = mkdtempSync(join(tmpdir(), 'sessclone-archive-config-'))
  const project = join(dir, 'projects', 'home-dev-api')
  const runs = join(project, 'session-a', 'subagents')
  await mkdir(runs, { recursive: true })
  await writeFile(join(project, 'session-a.jsonl'), '{"main":1}\n')
  await writeFile(join(runs, 'agent-7.jsonl'), '{"run":1}\n')

  const calls = stubFetch({ presign: { body: { refused: 'archival_off' } } })

  // The hook has ten seconds and an upload may take eight, so the deadline is
  // what keeps a Session with several runs from being killed mid-request. The
  // test above proves both transcripts are asked about when there is time.
  await archiveSession({
    configuration: config,
    transcriptPath: join(project, 'session-a.jsonl'),
    sessionId: 'session-a',
    environment: { CLAUDE_CONFIG_DIR: dir },
    deadline: Date.now() - 1,
  })

  expect(calls).toHaveLength(0)
})

test('only a cloud container archives after every turn', () => {
  // Ticket 99: a cloud container never runs SessionEnd and takes its files
  // with it, so its transcript goes up per turn; a laptop keeps the end-of-
  // session upload and the sweep, and spends no bytes per turn.
  expect(archivesEveryTurn({ CLAUDE_CODE_REMOTE: 'true' })).toBe(true)
  expect(archivesEveryTurn({ CLAUDE_CODE_REMOTE: ' true\n' })).toBe(true)
  expect(archivesEveryTurn({})).toBe(false)
  expect(archivesEveryTurn({ CLAUDE_CODE_REMOTE: 'false' })).toBe(false)
})

/**
 * A Session with one transcript and no Agent Runs, and a `fetch` whose
 * presign answers come from a list in order, the last repeating. Each request
 * is recorded by its step, in the order the requests were made.
 */
const turnFixture = async (presigns, { putDelayMs = 0 } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'sessclone-archive-turn-'))
  const project = join(dir, 'projects', 'home-dev-api')
  await mkdir(project, { recursive: true })
  const transcriptPath = join(project, 'session-a.jsonl')
  await writeFile(transcriptPath, '{"main":1}\n')
  const steps = []
  let asked = 0
  vi.stubGlobal('fetch', async (url) => {
    const target = String(url)
    if (target.includes('/api/logs/presign')) {
      const body = presigns[Math.min(asked, presigns.length - 1)]
      asked += 1
      steps.push('presign')
      return { ok: true, status: 200, json: async () => body }
    }
    if (target.includes('/api/logs/confirm')) {
      steps.push('confirm')
      return {
        ok: true,
        status: 200,
        json: async () => ({ stored: true, sizeBytes: 11 }),
      }
    }
    steps.push('put')
    await new Promise((resolve) => setTimeout(resolve, putDelayMs))
    return { ok: true, status: 200, json: async () => null }
  })
  return {
    steps,
    input: {
      configuration: configuration(),
      transcriptPath,
      sessionId: 'session-a',
      environment: { CLAUDE_CONFIG_DIR: dir },
      deadline: Date.now() + 10_000,
      retryAfterMs: 10,
    },
  }
}

const ISSUED = {
  url: 'https://storage.test/object?signed',
  storageKey: 'orgs/o/members/m/projects/p/session-a.jsonl',
}

test('a first turn that beats its own flush is asked again', async () => {
  // Ticket 99: the per-turn archive starts beside the Stop flush, so on a
  // Session's first turn the presign can arrive before any Turn has, and is
  // refused `no_turns`. Without a second ask a single-turn cloud Session is
  // never archived.
  const { steps, input } = await turnFixture([{ refused: 'no_turns' }, ISSUED])
  const result = await archiveAfterTurn(input)
  expect(result.archived).toBe(1)
  expect(steps).toEqual(['presign', 'presign', 'put', 'confirm'])
})

test('a turn’s archive waits for the previous turn’s to finish', async () => {
  // Two overlapping runs can confirm in the opposite order to their PUTs,
  // leaving the row naming bytes the object no longer holds. So the second
  // waits, and goes after — it holds the newer bytes.
  const { steps, input } = await turnFixture([ISSUED], { putDelayMs: 50 })
  const [first, second] = await Promise.all([
    archiveAfterTurn(input),
    archiveAfterTurn(input),
  ])
  expect(first.archived + second.archived).toBeGreaterThanOrEqual(1)
  // Never interleaved: each presign is followed by its own put and confirm.
  expect(steps.join(' ')).toMatch(
    /^presign put confirm( presign( put confirm)?)?$/,
  )
})

test('a Session’s sidecars are asked about under their own kind, with the right content type', async () => {
  // Ticket 104: the run's `.meta.json` and the workflow's `journal.jsonl` are
  // archived beside the transcripts, each presigned with the kind the
  // deployment files it under.
  const config = configuration()
  const dir = mkdtempSync(join(tmpdir(), 'sessclone-archive-config-'))
  const project = join(dir, 'projects', 'home-dev-api')
  const runs = join(project, 'session-a', 'subagents')
  const workflow = join(runs, 'workflows', 'wf_9')
  await mkdir(workflow, { recursive: true })
  await writeFile(join(project, 'session-a.jsonl'), '{"main":1}\n')
  await writeFile(join(runs, 'agent-7.jsonl'), '{"run":1}\n')
  await writeFile(join(runs, 'agent-7.meta.json'), '{"spawnDepth":1}')
  await writeFile(join(workflow, 'journal.jsonl'), '{"type":"started"}\n')

  const calls = stubFetch({
    presign: {
      body: { url: 'https://storage.test/o?signed', storageKey: 'k' },
    },
    put: { ok: true },
    confirm: { body: { stored: true, sizeBytes: 1 } },
  })

  const { archived } = await archiveSession({
    configuration: config,
    transcriptPath: join(project, 'session-a.jsonl'),
    sessionId: 'session-a',
    environment: { CLAUDE_CONFIG_DIR: dir },
  })

  expect(archived).toBe(4)
  const presigned = calls
    .filter((call) => path(call) === '/api/logs/presign')
    .map((call) => JSON.parse(call.init.body))
    .map(({ kind, agentId }) => `${kind}:${agentId}`)
  expect(presigned.toSorted()).toEqual([
    'agent_meta:7',
    'transcript:7',
    'transcript:null',
    'workflow_journal:wf_9',
  ])
  const confirmed = calls
    .filter((call) => path(call) === '/api/logs/confirm')
    .map((call) => JSON.parse(call.init.body).kind)
  expect(confirmed.toSorted(byText)).toEqual([
    'agent_meta',
    'transcript',
    'transcript',
    'workflow_journal',
  ])
  const types = calls
    .filter((call) => call.method === 'PUT')
    .map((call) => call.init.headers['content-type'])
  expect(types.toSorted(byText)).toEqual([
    'application/json',
    'application/x-ndjson',
    'application/x-ndjson',
    'application/x-ndjson',
  ])
})

/** @param {string} a @param {string} b */
function byText(a, b) {
  return a.localeCompare(b)
}
