import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, beforeEach, expect, test } from 'vitest'

import { POST as ingest } from '../app/api/ingest/route'
import { owner as sql, seedFixture, type Fixture } from './harness'

const run = promisify(execFile)

// Ticket 33: the tracer, with real parts.
//
// The real hook binary, run as Claude Code runs it — `node stop.mjs` with the
// event on stdin — against a real transcript from the corpus, the real ingest
// route, and the real database with the real migrations. Nothing between the
// hook and the row is a stub except the HTTP server, which is here only so
// the route can be called in-process rather than deployed.
//
// This is the ticket's whole point: every layer had tests and none of them
// proved the layers fit together. Ticket 02's probe proved a hook could reach
// the database with a session id; this proves a hook reaches it with a Turn.

const HOOK = new URL('../../../packages/plugin/hooks/stop.mjs', import.meta.url)
const CORPUS = new URL(
  '../../../packages/shared/fixtures/transcripts/',
  import.meta.url,
)

let fixture: Fixture
let server: Server
let url: string
/** Every request the hook made, exactly as it went over the socket. */
let received: { body: string; authorization: string | undefined }[] = []

/** The route, behind a real socket, because the hook makes a real request. */
const serve = () =>
  new Promise<void>((resolve) => {
    server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk) => chunks.push(chunk))
      request.on('end', async () => {
        received.push({
          body: Buffer.concat(chunks).toString('utf8'),
          authorization: request.headers.authorization,
        })
        const answer = await ingest(
          new Request(`http://127.0.0.1${request.url}`, {
            method: 'POST',
            headers: Object.fromEntries(
              Object.entries(request.headers).flatMap(([name, value]) =>
                typeof value === 'string' ? [[name, value]] : [],
              ),
            ),
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        )
        response.writeHead(answer.status, {
          'content-type': 'application/json',
        })
        response.end(await answer.text())
      })
    })
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
      resolve()
    })
  })

beforeEach(async () => {
  fixture = await seedFixture()
  received = []
  await serve()
})

afterEach(
  () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve())
    }),
)

/** A live key for the fixture's Member, issued the way the dashboard issues one. */
const issueKey = async () => {
  const { createApiKey } = await import('../lib/api-keys')
  const { asUser } = await import('./harness')
  return asUser(fixture.acme.users.member, (tx) =>
    createApiKey(tx, 'laptop', fixture.acme.members.member),
  )
}

/** Runs the hook exactly as Claude Code does: the event on stdin, no arguments. */
const runHook = async (
  event: Record<string, unknown>,
  environment: Record<string, string>,
) => {
  const child = run('node', [HOOK.pathname], {
    env: { ...process.env, ...environment },
    cwd: tmpdir(),
  })
  child.child.stdin?.end(JSON.stringify(event))
  return child
}

const transcript = async (
  name: string,
  rewrite: (raw: string) => string = (raw) => raw,
) => {
  const text = rewrite(await readFile(new URL(name, CORPUS), 'utf8'))
  const directory = mkdtempSync(join(tmpdir(), 'sessclone-tracer-'))
  const path = join(directory, name)
  writeFileSync(path, text)
  return { path, text }
}

test('a finished session reaches the database as Turns, on this Device and Project', async () => {
  const key = await issueKey()
  const { path, text } = await transcript('multi-iteration-turn.jsonl')

  // The session id the transcript's own entries carry: Claude Code names the
  // same one in the hook event.
  const sessionId = JSON.parse(text.split('\n').find(Boolean)!).sessionId

  const { stderr } = await runHook(
    { session_id: sessionId, transcript_path: path, cwd: '/home/dev/api' },
    {
      SESSCLONE_URL: url,
      SESSCLONE_API_KEY: key,
      SESSCLONE_DEVICE: 'host:tracer-box',
    },
  )

  // A hook that writes to stderr writes into the next transcript, which this
  // product uploads.
  expect(stderr).toBe('')

  const turns = await sql<
    {
      session_id: string
      message_id: string
      model: string | null
      input_tokens: number
      output_tokens: number
      cache_read_input_tokens: number
      device_key: string
      project_key: string
      member_id: string
    }[]
  >`
    select turn.session_id, turn.message_id, turn.model, turn.input_tokens,
           turn.output_tokens, turn.cache_read_input_tokens,
           device.key as device_key, project.key as project_key, turn.member_id
      from turns turn
      join devices device on device.id = turn.device_id
      join projects project on project.id = turn.project_id
     order by turn.message_id
  `

  // Checked against the fixture by hand once, which is this ticket's own
  // criterion: `multi-iteration-turn.jsonl` is one user turn answered in two
  // API iterations, and the counters are per iteration rather than summed.
  expect(turns).toHaveLength(2)
  expect(turns.map((turn) => turn.session_id)).toEqual([sessionId, sessionId])
  expect(
    turns.every((turn) => turn.member_id === fixture.acme.members.member),
  ).toBe(true)
  expect(new Set(turns.map((turn) => turn.device_key))).toEqual(
    new Set(['host:tracer-box']),
  )
})

test('the counters stored are the counters in the transcript', async () => {
  const key = await issueKey()
  const { path, text } = await transcript('multi-iteration-turn.jsonl')
  const sessionId = JSON.parse(text.split('\n').find(Boolean)!).sessionId

  await runHook(
    { session_id: sessionId, transcript_path: path, cwd: '/home/dev/api' },
    { SESSCLONE_URL: url, SESSCLONE_API_KEY: key },
  )

  // Read straight out of the fixture here rather than restated as literals:
  // what this asserts is that nothing between the file and the column changed
  // a number, so the file has to be the source of both sides.
  const expected = new Map<
    string,
    { input: number; output: number; cacheRead: number }
  >()
  for (const line of text.split('\n').filter(Boolean)) {
    const entry = JSON.parse(line)
    const usage = entry.message?.usage
    if (!usage || entry.type !== 'assistant') continue
    const seen = expected.get(entry.message.id)
    const candidate = {
      input: usage.input_tokens ?? 0,
      output: usage.output_tokens ?? 0,
      cacheRead: usage.cache_read_input_tokens ?? 0,
    }
    // The parser keeps the largest block of a repeated message id, which is
    // the completed count rather than the partial one written mid-stream.
    if (!seen || candidate.output > seen.output) {
      expected.set(entry.message.id, candidate)
    }
  }

  const stored = await sql<
    {
      message_id: string
      input_tokens: number
      output_tokens: number
      cache_read_input_tokens: number
    }[]
  >`
    select message_id, input_tokens, output_tokens, cache_read_input_tokens
      from turns
  `

  // And the hand check the ticket asks for, once, written down: the first
  // Turn of `multi-iteration-turn.jsonl` reads, in the file,
  // input 10 · output 130 (49 of them thinking) · cache read 28,880 ·
  // cache creation 24,982, all of it at the 1h rate.
  const [first] = await sql<
    {
      input_tokens: number
      output_tokens: number
      thinking_tokens: number
      cache_read_input_tokens: number
      cache_creation_input_tokens: number
      cache_creation_5m_input_tokens: number
      cache_creation_1h_input_tokens: number
      web_search_requests: number
      web_fetch_requests: number
    }[]
  >`
    select input_tokens, output_tokens, thinking_tokens,
           cache_read_input_tokens, cache_creation_input_tokens,
           cache_creation_5m_input_tokens, cache_creation_1h_input_tokens,
           web_search_requests, web_fetch_requests
      from turns where message_id = 'msg_011CeyPgUZhxsaWEmugf7KzB'
  `
  expect(first).toEqual({
    input_tokens: 10,
    output_tokens: 130,
    thinking_tokens: 49,
    cache_read_input_tokens: 28_880,
    cache_creation_input_tokens: 24_982,
    cache_creation_5m_input_tokens: 0,
    cache_creation_1h_input_tokens: 24_982,
    web_search_requests: 0,
    web_fetch_requests: 0,
  })

  expect(stored).toHaveLength(expected.size)
  for (const turn of stored) {
    expect(expected.get(turn.message_id)).toEqual({
      input: turn.input_tokens,
      output: turn.output_tokens,
      cacheRead: turn.cache_read_input_tokens,
    })
  }
})

test('the Project is the repository the session ran in, not its directory name', async () => {
  const key = await issueKey()

  // A real repository with a real remote, so the resolution is the one a
  // Member's machine performs rather than a value handed to the code.
  const repository = mkdtempSync(join(tmpdir(), 'sessclone-repo-'))
  await run('git', ['init', '--quiet'], { cwd: repository })
  await run('git', ['remote', 'add', 'origin', 'git@github.com:acme/api.git'], {
    cwd: repository,
  })

  // The fixture was captured elsewhere, so its entries name a directory that
  // is not this repository. Rewritten to it, the `git` read is the only thing
  // that can produce the key asserted below — which is what makes this cover
  // the remote path rather than the fallback.
  const { path, text } = await transcript(
    'multi-iteration-turn.jsonl',
    (raw) => {
      const ran = raw
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line).cwd)
        .find((directory) => typeof directory === 'string')!
      return raw.replaceAll(ran, repository)
    },
  )
  const sessionId = JSON.parse(text.split('\n').find(Boolean)!).sessionId

  await runHook(
    { session_id: sessionId, transcript_path: path, cwd: repository },
    { SESSCLONE_URL: url, SESSCLONE_API_KEY: key },
  )

  const [project] = await sql<{ key: string; remote: string | null }[]>`
    select key, remote from projects
  `
  expect(project!.key).toBe('github.com/acme/api')
  expect(project!.remote).toBe('git@github.com:acme/api.git')
})

test('the credential travels in the header and never in the body', async () => {
  // The stated property of this hook. `IngestPayload` strips unknown keys
  // rather than refusing them, so nothing on the route's side would notice a
  // key that started riding along in the body a proxy logs.
  const key = await issueKey()
  const { path, text } = await transcript('multi-iteration-turn.jsonl')
  const sessionId = JSON.parse(text.split('\n').find(Boolean)!).sessionId

  await runHook(
    { session_id: sessionId, transcript_path: path, cwd: '/home/dev/api' },
    { SESSCLONE_URL: url, SESSCLONE_API_KEY: key },
  )

  expect(received).toHaveLength(1)
  expect(received[0]!.authorization).toBe(`Bearer ${key}`)
  expect(received[0]!.body).not.toContain('sk_')
  expect(received[0]!.body).not.toContain(key)
})

test('an Agent Run reaches the database as its own Turns, under its parent Session', async () => {
  // Tickets 35 and 36 end to end: the hook is given the Session's own file, and
  // the runs it spawned are found beside it, read from their own transcripts
  // and filed under their own `agentId` — a workflow's run on the same path as
  // any other, which is why one of the two here is one.
  const key = await issueKey()
  const config = mkdtempSync(join(tmpdir(), 'sessclone-claude-'))
  const project = join(config, 'projects', '-home-user-sessclone')
  const sessionId = '456e47f6-e387-59c4-b84c-21c031bb3504'
  mkdirSync(join(project, sessionId, 'subagents'), { recursive: true })

  const parent = await readFile(
    new URL('multi-iteration-turn.jsonl', CORPUS),
    'utf8',
  )
  const captured = JSON.parse(parent.split('\n').find(Boolean)!).sessionId
  const main = join(project, `${sessionId}.jsonl`)
  writeFileSync(main, parent.replaceAll(captured, sessionId))

  await Promise.all(
    (
      [
        ['agent-run.jsonl', 'a4a571530bd42856c', 1],
        ['workflow-agent-run.jsonl', 'a38fc2c136a5f46a3', 2],
      ] as const
    ).map(async ([name, agentId, spawnDepth]) => {
      writeFileSync(
        join(project, sessionId, 'subagents', `agent-${agentId}.jsonl`),
        await readFile(new URL(name, CORPUS), 'utf8'),
      )
      writeFileSync(
        join(project, sessionId, 'subagents', `agent-${agentId}.meta.json`),
        JSON.stringify({ spawnDepth }),
      )
    }),
  )

  await runHook(
    {
      session_id: sessionId,
      transcript_path: main,
      cwd: '/home/user/sessclone',
    },
    { SESSCLONE_URL: url, SESSCLONE_API_KEY: key, CLAUDE_CONFIG_DIR: config },
  )

  const stored = await sql<
    { agent_id: string | null; spawn_depth: number | null; turns: number }[]
  >`
    select agent_id, spawn_depth, count(*)::int as turns
      from turns
     where session_id = ${sessionId}
     group by agent_id, spawn_depth
     order by agent_id nulls first
  `

  expect(stored.map((row) => [row.agent_id, row.spawn_depth])).toEqual([
    [null, null],
    ['a38fc2c136a5f46a3', 2],
    ['a4a571530bd42856c', 1],
  ])
  expect(stored.every((row) => row.turns > 0)).toBe(true)
})

test('a second Stop on an unchanged transcript sends nothing at all', async () => {
  // Ticket 37, end to end: the cursor is stored under `SESSCLONE_STATE_DIR`
  // after the deployment accepted the report, and the next Stop reads the file
  // from there — so a steady-state turn costs a few hundred bytes rather than
  // a resend of the session, and an unchanged transcript costs no request.
  const key = await issueKey()
  const { path, text } = await transcript('multi-iteration-turn.jsonl')
  const sessionId = JSON.parse(text.split('\n').find(Boolean)!).sessionId
  const stateDir = mkdtempSync(join(tmpdir(), 'sessclone-state-'))

  const environment = {
    SESSCLONE_URL: url,
    SESSCLONE_API_KEY: key,
    SESSCLONE_STATE_DIR: stateDir,
  }
  const event = {
    session_id: sessionId,
    transcript_path: path,
    cwd: '/home/dev/api',
  }

  await runHook(event, environment)
  expect(received).toHaveLength(1)

  const [first] = await sql<{ count: number }[]>`
    select count(*)::int as count from turns
  `

  await runHook(event, environment)
  expect(received).toHaveLength(1)

  const [second] = await sql<{ count: number }[]>`
    select count(*)::int as count from turns
  `
  expect(second!.count).toBe(first!.count)
})

test('a report the deployment refused leaves the cursor where it was', async () => {
  // The one mistake that loses a Turn: advancing a cursor past Turns nobody
  // accepted. The key here is well-formed and unknown, so ingest answers 401.
  const { path, text } = await transcript('multi-iteration-turn.jsonl')
  const sessionId = JSON.parse(text.split('\n').find(Boolean)!).sessionId
  const stateDir = mkdtempSync(join(tmpdir(), 'sessclone-state-'))
  const event = {
    session_id: sessionId,
    transcript_path: path,
    cwd: '/home/dev/api',
  }

  await runHook(event, {
    SESSCLONE_URL: url,
    SESSCLONE_API_KEY: `sk_${'a'.repeat(43)}`,
    SESSCLONE_STATE_DIR: stateDir,
  })

  // Nothing stored, and nothing acknowledged — so a key fixed tomorrow
  // reports everything that was refused today.
  const key = await issueKey()
  await runHook(event, {
    SESSCLONE_URL: url,
    SESSCLONE_API_KEY: key,
    SESSCLONE_STATE_DIR: stateDir,
  })

  const [stored] = await sql<{ count: number }[]>`
    select count(*)::int as count from turns
  `
  expect(stored!.count).toBeGreaterThan(0)
})

test('a session whose deployment is unreachable fails quietly and stores nothing', async () => {
  const key = await issueKey()
  const { path, text } = await transcript('multi-iteration-turn.jsonl')
  const sessionId = JSON.parse(text.split('\n').find(Boolean)!).sessionId

  const { stdout, stderr } = await runHook(
    { session_id: sessionId, transcript_path: path, cwd: '/home/dev/api' },
    // Nothing listens here. A hook error notice on every turn is a poor way
    // to report that a deployment is down, and stderr would be uploaded.
    { SESSCLONE_URL: 'http://127.0.0.1:9', SESSCLONE_API_KEY: key },
  )

  expect(stdout).toBe('')
  expect(stderr).toBe('')
  const [stored] = await sql<{ count: number }[]>`
    select count(*)::int as count from turns
  `
  expect(stored!.count).toBe(0)
})

test('a key that is not live stores nothing, and says nothing', async () => {
  const { path, text } = await transcript('multi-iteration-turn.jsonl')
  const sessionId = JSON.parse(text.split('\n').find(Boolean)!).sessionId

  const { stderr } = await runHook(
    { session_id: sessionId, transcript_path: path, cwd: '/home/dev/api' },
    {
      SESSCLONE_URL: url,
      // Well-formed and unknown: ingest answers one 401 for absent,
      // malformed, unknown and revoked alike, so it is no oracle.
      SESSCLONE_API_KEY: `sk_${'a'.repeat(43)}`,
    },
  )

  expect(stderr).toBe('')
  const [stored] = await sql<{ count: number }[]>`
    select count(*)::int as count from turns
  `
  expect(stored!.count).toBe(0)
})
