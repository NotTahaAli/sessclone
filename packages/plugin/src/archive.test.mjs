import { mkdtempSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
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
  gzipRange,
  hashFile,
  planSeals,
  sealPlan,
} from './archive.mjs'

// Ticket 59. What matters here is the order and the refusals: nothing leaves
// the machine before the deployment says yes, a refusal costs one small
// request and no upload, and a row is only claimed once the confirm succeeded.

afterEach(() => vi.unstubAllGlobals())

// Lets a test make compression throw, which is one of the fallback triggers.
const gzipFails = vi.hoisted(() => ({ value: false }))
vi.mock('node:zlib', async (importOriginal) => {
  const zlib = await importOriginal()
  return {
    ...zlib,
    createGzip: (...args) => {
      if (gzipFails.value) throw new Error('no zlib here')
      return zlib.createGzip(...args)
    },
  }
})

// Every read of a file from disk, so a test can count how often a pass
// reads a transcript from its first byte.
const reads = vi.hoisted(() => [])
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal()
  return {
    ...fs,
    createReadStream: (path, options) => {
      reads.push({ path: String(path), ...options })
      return fs.createReadStream(path, options)
    },
  }
})

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
    // A body may be a function of the request's, as a server echoing it is.
    const body =
      typeof answer.body === 'function'
        ? answer.body(JSON.parse(init.body))
        : answer.body
    return {
      ok: answer.ok ?? true,
      status: answer.status ?? 200,
      json: async () => body ?? null,
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
      // A server that knows kinds echoes the one it presigned for.
      body: ({ kind }) => ({
        url: 'https://storage.test/o?signed',
        storageKey: 'k',
        kind,
      }),
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

test('a server that does not echo the kind gets no sidecars, only transcripts', async () => {
  // An older deployment strips `kind`, and would file a `.meta.json` as the
  // run's transcript. Its presign answer carries no `kind`, so the sidecar is
  // skipped before its bytes move.
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

  expect(archived).toBe(2)
  const confirmed = calls
    .filter((call) => path(call) === '/api/logs/confirm')
    .map((call) => JSON.parse(call.init.body).kind)
  expect(confirmed).toEqual(['transcript', 'transcript'])
  expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(2)
})

/** @param {string} a @param {string} b */
function byText(a, b) {
  return a.localeCompare(b)
}

// Ticket 131 (ADR 0008): chunked archival. The pure pieces first.

const MiB = 1024 * 1024
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
/** `count` bytes of one line: `x` repeated, ending in a newline. */
const line = (count) => Buffer.concat([Buffer.alloc(count - 1, 'x'), NL])
const NL = Buffer.from('\n')

test('a chunk is cut at the first line end at or after 1 MiB', () => {
  // Exactly 1 MiB, the newline its last byte: cut right there.
  const exact = Buffer.concat([line(MiB), line(10)])
  expect(sealPlan(exact, 0)).toEqual([MiB])
  // A line longer than 1 MiB is never split: the chunk runs to its end.
  const long = Buffer.concat([line(10), line(MiB + 500), line(10)])
  expect(sealPlan(long, 0)).toEqual([10 + MiB + 500])
  // No line end at all: nothing seals, everything is tail.
  expect(sealPlan(Buffer.alloc(2 * MiB, 'x'), 0)).toEqual([])
  // A partial last line stays in the tail, even past 1 MiB.
  const partial = Buffer.concat([line(MiB), Buffer.alloc(MiB + 1, 'y')])
  expect(sealPlan(partial, 0)).toEqual([MiB])
  // Planning counts from where the sealed prefix ends, so the first line end
  // at or after 1 MiB from there is the next line's.
  expect(sealPlan(exact, 5)).toEqual([MiB + 10])
})

test('one pass seals at most sixteen chunks', () => {
  const many = Buffer.concat(Array.from({ length: 20 }, () => line(8)))
  const cuts = sealPlan(many, 0, { chunkBytes: 8 })
  expect(cuts).toHaveLength(16)
  expect(cuts.at(-1)).toBe(16 * 8)
})

test('the plan checks the sealed prefix before continuing from it', async () => {
  const prefix = line(64)
  const file = await transcript(Buffer.concat([prefix, line(40), line(40)]))
  const sealed = { bytes: 64, sha256: sha(prefix), chunks: 1 }
  const size = 64 + 80

  const plan = await planSeals(file, size, sealed, { chunkBytes: 40 })
  expect(plan.chunks).toEqual([
    { seq: 2, rawOffset: 64, rawLength: 40, sha256: sha(line(40)) },
    { seq: 3, rawOffset: 104, rawLength: 40, sha256: sha(line(40)) },
  ])
  expect(plan.sealedSha256).toBe(
    sha(Buffer.concat([prefix, line(40), line(40)])),
  )

  // Rewritten: same length, different bytes.
  const rewritten = { ...sealed, sha256: sha(line(64).fill('z', 0, 1)) }
  expect(await planSeals(file, size, rewritten)).toBe('mismatch')
  // Truncated: the file is now shorter than what is sealed.
  expect(await planSeals(file, 50, sealed)).toBe('mismatch')
  // Sealed somewhere this Collector would not have cut: the plan cannot
  // continue from it, so the pass falls back to the whole file.
  const raw = Buffer.concat([prefix, line(40), line(40)])
  const offCut = { bytes: 50, sha256: sha(raw.subarray(0, 50)), chunks: 1 }
  expect(await planSeals(file, size, offCut, { chunkBytes: 40 })).toBe(
    'mismatch',
  )
})

test('a gzipped chunk inflates to exactly its raw bytes', async () => {
  const raw = Buffer.concat([line(100), line(200), line(300)])
  const file = await transcript(raw)
  const packed = await gzipRange(file, 100, 200)
  expect(gunzipSync(packed)).toEqual(raw.subarray(100, 300))
})

test('a plan read in many pieces cuts where one whole read would', async () => {
  // The read streams in pieces far smaller than a chunk, so chunks and the
  // sealed prefix both straddle piece boundaries.
  // A sealed prefix is always a cut: the first line end at or after 1 MiB.
  const prefix = line(MiB + 3)
  const raw = Buffer.concat([prefix, line(MiB + 7), line(MiB), line(99)])
  const file = await transcript(raw)
  const sealed = { bytes: prefix.length, sha256: sha(prefix), chunks: 1 }
  const plan = await planSeals(file, raw.length, sealed)
  const ends = sealPlan(raw, prefix.length)
  expect(ends).toEqual([prefix.length + MiB + 7, prefix.length + 2 * MiB + 7])
  expect(plan.chunks.map((chunk) => chunk.rawOffset + chunk.rawLength)).toEqual(
    ends,
  )
  expect(plan.chunks.map((chunk) => chunk.seq)).toEqual([2, 3])
  expect(plan.chunks[1].sha256).toBe(sha(raw.subarray(ends[0], ends[1])))
  expect(plan.sealedSha256).toBe(sha(raw.subarray(0, ends[1])))
})

/** An answer as `fetch` resolves it. */
const reply = (body) => ({ ok: true, status: 200, json: async () => body })

/**
 * A deployment that chunks (ADR 0008), or one that predates it (`echo:
 * false`). It holds `sealed` as the row would, answers seals from the next
 * seq, and records every request as a step plus what it carried.
 */
const fakeDeployment = ({
  sealed = { bytes: 0, sha256: null, chunks: 0 },
  echo = true,
  confirms = [],
} = {}) => {
  const requests = []
  vi.stubGlobal('fetch', async (url, init) => {
    const target = String(url)
    if (target.includes('/api/logs/presign')) {
      const body = JSON.parse(init.body)
      requests.push({
        step: body.seal
          ? `presign seal ${body.seal.length}`
          : `presign ${body.layout}`,
        body,
      })
      if (!echo || body.layout !== 'chunked') {
        return reply({
          url: 'https://storage.test/whole?signed',
          storageKey: 'p/session-a.jsonl',
          ...(echo && { kind: body.kind, pass: body.pass ?? PASS }),
        })
      }
      const seals = Array.from(
        { length: body.seal?.length ?? 0 },
        (_, index) => {
          const seq = sealed.chunks + 1 + index
          return {
            seq,
            url: `https://storage.test/chunk-${seq}?signed`,
            storageKey: `p/session-a/chunks/${seq}`,
          }
        },
      )
      const tail = sealed.chunks + seals.length
      return reply({
        url: `https://storage.test/tail-${tail}?signed`,
        storageKey: `p/session-a/tail-${tail}`,
        kind: body.kind,
        pass: body.pass ?? PASS,
        layout: 'chunked',
        sealed,
        ...(seals.length > 0 && { seals }),
      })
    }
    if (target.includes('/api/logs/confirm')) {
      const body = JSON.parse(init.body)
      requests.push({ step: 'confirm', body })
      return reply(confirms.shift() ?? { stored: true, sizeBytes: 1 })
    }
    const bytes = Buffer.from(await new Response(init.body).arrayBuffer())
    requests.push({
      step: `put ${new URL(target).pathname.slice(1)}`,
      headers: init.headers,
      bytes,
    })
    return reply(null)
  })
  return requests
}

const steps = (requests) => requests.map((request) => request.step)

/** The pass id the fake deployment draws when a presign names none. */
const PASS = 'feedfacefeedface'

/** The raw bytes that went to storage, chunks inflated, in request order. */
const sentRaw = (requests) =>
  Buffer.concat(
    requests
      .filter((request) => request.step.startsWith('put'))
      .map((request) =>
        request.headers['content-type'] === 'application/gzip'
          ? gunzipSync(request.bytes)
          : request.bytes,
      ),
  )

const archiveChunked = async (contents, deployment) => {
  const requests = fakeDeployment(deployment)
  const result = await archiveTranscript({
    configuration: configuration(),
    transcriptPath: await transcript(contents),
    sessionId: 'session-a',
  })
  return { result, requests }
}

test('a steady turn sends only the tail after the sealed prefix', async () => {
  // A sealed prefix ends where this Collector would have cut it.
  const prefix = line(MiB)
  const raw = Buffer.concat([prefix, line(30)])
  const { result, requests } = await archiveChunked(raw, {
    sealed: { bytes: MiB, sha256: sha(prefix), chunks: 1 },
  })

  expect(result).toMatchObject({ archived: true })
  expect(steps(requests)).toEqual(['presign chunked', 'put tail-1', 'confirm'])
  expect(sha(sentRaw(requests))).toBe(sha(raw.subarray(MiB)))
  const confirm = requests.at(-1).body
  expect(confirm).toMatchObject({
    layout: 'chunked',
    sha256: sha(raw),
    storageKey: 'p/session-a/tail-1',
  })
  expect(confirm.chunks).toBeUndefined()
})

test('a sealing turn presigns the seals, PUTs gzip chunks, then the tail', async () => {
  // A sealed prefix ends where this Collector would have cut it.
  const prefix = line(MiB)
  const raw = Buffer.concat([prefix, line(MiB), line(MiB), line(50)])
  const { result, requests } = await archiveChunked(raw, {
    sealed: { bytes: MiB, sha256: sha(prefix), chunks: 1 },
  })

  expect(result).toMatchObject({ archived: true })
  expect(steps(requests)).toEqual([
    'presign chunked',
    'presign seal 2',
    'put chunk-2',
    'put chunk-3',
    'put tail-3',
    'confirm',
  ])
  // Only the bytes after the sealed prefix, each exactly once.
  expect(sha(sentRaw(requests))).toBe(sha(raw.subarray(MiB)))
  // The seal names each planned chunk's hash, which its key is built from.
  expect(requests[1].body.seal).toEqual([
    { seq: 2, sha256: sha(raw.subarray(MiB, 2 * MiB)) },
    { seq: 3, sha256: sha(raw.subarray(2 * MiB, 3 * MiB)) },
  ])
  for (const put of requests.filter((r) => r.step.startsWith('put chunk'))) {
    expect(put.headers['content-type']).toBe('application/gzip')
    expect(put.headers['content-encoding']).toBeUndefined()
    expect(put.headers['content-length']).toBe(String(put.bytes.length))
  }
  const end = 3 * MiB
  expect(requests.at(-1).body).toMatchObject({
    layout: 'chunked',
    sha256: sha(raw),
    storageKey: 'p/session-a/tail-3',
    sealedSha256: sha(raw.subarray(0, end)),
    chunks: [
      {
        seq: 2,
        rawOffset: MiB,
        rawLength: MiB,
        sha256: sha(raw.subarray(MiB, 2 * MiB)),
      },
      {
        seq: 3,
        rawOffset: 2 * MiB,
        rawLength: MiB,
        sha256: sha(raw.subarray(2 * MiB, end)),
      },
    ],
  })
})

test('a Session that moved Project reseals from the first chunk', async () => {
  // Its new prefix holds nothing, so the deployment answers zeros.
  const raw = Buffer.concat([line(MiB), line(20)])
  const { requests } = await archiveChunked(raw, {})
  expect(steps(requests)).toEqual([
    'presign chunked',
    'presign seal 1',
    'put chunk-1',
    'put tail-1',
    'confirm',
  ])
  expect(sha(sentRaw(requests))).toBe(sha(raw))
})

test('a transcript under 1 MiB is archived as it always was', async () => {
  const raw = line(30)
  const { requests } = await archiveChunked(raw, {})
  expect(steps(requests)).toEqual(['presign chunked', 'put tail-0', 'confirm'])
  expect(sha(sentRaw(requests))).toBe(sha(raw))
})

test('a truncated or rewritten transcript falls back to the whole file', async () => {
  const prefix = line(100)
  const raw = Buffer.concat([prefix, line(30)])
  for (const sealed of [
    // Truncated: more is sealed than the file now holds.
    { bytes: 500, sha256: sha(line(500)), chunks: 1 },
    // Rewritten: the prefix hashes differently.
    { bytes: 100, sha256: sha(line(100).fill('z', 0, 1)), chunks: 1 },
  ]) {
    // eslint-disable-next-line no-await-in-loop -- one trigger at a time, so a failure names which
    const { result, requests } = await archiveChunked(raw, { sealed })
    expect(result).toMatchObject({ archived: true })
    expect(steps(requests)).toEqual([
      'presign chunked',
      'presign whole',
      'put whole',
      'confirm',
    ])
    expect(sha(sentRaw(requests))).toBe(sha(raw))
    expect(requests.at(-1).body).toMatchObject({
      layout: 'whole',
      storageKey: 'p/session-a.jsonl',
    })
  }
})

test('a deployment that does not chunk gets the whole file, as today', async () => {
  const raw = Buffer.concat([line(MiB), line(30)])
  const { result, requests } = await archiveChunked(raw, { echo: false })
  expect(result).toMatchObject({ archived: true })
  expect(steps(requests)).toEqual(['presign chunked', 'put whole', 'confirm'])
  expect(sha(sentRaw(requests))).toBe(sha(raw))
  expect(requests.at(-1).body.chunks).toBeUndefined()
})

test('a compression failure falls back to the whole file', async () => {
  gzipFails.value = true
  try {
    const raw = Buffer.concat([line(MiB), line(30)])
    const { result, requests } = await archiveChunked(raw, {})
    expect(result).toMatchObject({ archived: true })
    expect(steps(requests)).toEqual([
      'presign chunked',
      'presign seal 1',
      'presign whole',
      'put whole',
      'confirm',
    ])
    expect(sha(sentRaw(requests))).toBe(sha(raw))
  } finally {
    gzipFails.value = false
  }
})

test('stale chunks are presigned again once, and never settled', async () => {
  const raw = line(30)
  const stale = { refused: 'stale_chunks', detail: 'moved on' }
  const { result, requests } = await archiveChunked(raw, {
    confirms: [stale, stale, stale, stale],
  })
  // Bounded: a deployment that keeps refusing costs one retry, and the rest
  // is left to the next pass.
  expect(result).toEqual({ archived: false, refused: 'stale_chunks' })
  expect(steps(requests).filter((step) => step === 'confirm')).toHaveLength(2)

  const again = await archiveChunked(raw, { confirms: [stale] })
  expect(again.result).toMatchObject({ archived: true })
  expect(steps(again.requests)).toEqual([
    'presign chunked',
    'put tail-0',
    'confirm',
    'presign chunked',
    'put tail-0',
    'confirm',
  ])
})

test('sidecars never ask to be chunked', async () => {
  const requests = fakeDeployment({})
  await archiveTranscript({
    configuration: configuration(),
    transcriptPath: await transcript('{"spawnDepth":1}'),
    sessionId: 'session-a',
    agentId: '7',
    kind: 'agent_meta',
  })
  expect(steps(requests)).toEqual(['presign whole', 'put whole', 'confirm'])
})

/** How many times a pass read `file` from its first byte to `size`. */
const fullReads = (file, size) =>
  reads.filter(
    (read) => read.path === file && read.start === 0 && read.end === size - 1,
  ).length

test('a sealing pass reads the transcript from disk in full once', async () => {
  // The unchanged guard's hash, the prefix check and the plan come from one
  // read; after that only the new chunks and the tail are read, to send.
  // A sealed prefix ends where this Collector would have cut it.
  const prefix = line(MiB)
  const raw = Buffer.concat([prefix, line(MiB), line(MiB), line(50)])
  const file = await transcript(raw)
  const requests = fakeDeployment({
    sealed: { bytes: MiB, sha256: sha(prefix), chunks: 1 },
    confirms: [{ refused: 'stale_chunks', detail: 'moved on' }],
  })
  reads.length = 0

  const result = await archiveTranscript({
    configuration: configuration(),
    transcriptPath: file,
    sessionId: 'session-a',
  })

  expect(result).toMatchObject({ archived: true })
  // Even across a stale_chunks retry.
  expect(steps(requests).filter((step) => step === 'confirm')).toHaveLength(2)
  expect(fullReads(file, raw.length)).toBe(1)
})

test('a pass echoes its pass id on its later presigns and its confirm', async () => {
  // ADR 0008: the deployment takes only this pass's pending keys, and
  // queues the ones it signed and this pass did not use.
  const prefix = line(MiB)
  const raw = Buffer.concat([prefix, line(MiB), line(50)])
  const { requests } = await archiveChunked(raw, {
    sealed: { bytes: MiB, sha256: sha(prefix), chunks: 1 },
  })

  expect(steps(requests)).toEqual([
    'presign chunked',
    'presign seal 1',
    'put chunk-2',
    'put tail-2',
    'confirm',
  ])
  expect(requests[0].body.pass).toBeUndefined()
  expect(requests[1].body.pass).toBe(PASS)
  expect(requests.at(-1).body.pass).toBe(PASS)
})
