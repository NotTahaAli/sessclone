import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from 'vitest'

import { buildPayloads, originRemote } from './report.mjs'
import { IngestPayload } from '../../shared/src/ingest.ts'
import { TURNS_PER_REPORT } from '../../shared/src/limits.ts'

// Ticket 33's plumbing, at the level it can be proven cheaply. The end of the
// path — hook to row — is `apps/web/test/collector-tracer.test.ts`, which
// needs a database; what is here is the decisions this file makes on its own.

const transcript = (lines) => {
  const directory = mkdtempSync(join(tmpdir(), 'sessclone-report-'))
  const path = join(directory, 'session.jsonl')
  writeFileSync(path, lines.map((line) => JSON.stringify(line)).join('\n'))
  return path
}

const assistant = ({
  sessionId = 'session-1',
  messageId = 'msg_1',
  cwd = '/home/dev/api',
  agentId = null,
  output = 12,
} = {}) => ({
  type: 'assistant',
  uuid: `uuid-${messageId}`,
  sessionId,
  ...(agentId ? { agentId } : {}),
  cwd,
  timestamp: '2026-09-21T10:00:00.000Z',
  message: {
    id: messageId,
    model: 'claude-opus-4-6',
    usage: {
      input_tokens: 3,
      output_tokens: output,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  },
})

test('a report names the session, its Device and its Project', async () => {
  const path = transcript([assistant(), assistant({ messageId: 'msg_2' })])

  const [{ payload }] = await buildPayloads({
    transcriptPath: path,
    sessionId: 'session-1',
    cwd: '/home/dev/api',
    environment: { SESSCLONE_DEVICE: 'host:build-box' },
  })

  expect(payload.device.key).toBe('host:build-box')
  expect(payload.reports).toHaveLength(1)
  const [report] = payload.reports
  expect(report.sessionId).toBe('session-1')
  expect(report.agentId).toBeNull()
  expect(report.turns.map((turn) => turn.messageId)).toEqual(['msg_1', 'msg_2'])
  // The cursor is the last Turn and the whole file, because the whole file
  // was read. Ticket 37 makes it a position to resume from.
  expect(report.cursor.messageId).toBe('msg_2')
  expect(report.cursor.byteOffset).toBeGreaterThan(0)
})

test('a subagent’s turns are left for the transcript they belong to', async () => {
  // Finding 74: a subagent writes its own file under the parent's session id.
  // Reported from here they would be filed against the parent transcript, and
  // its cursor would then acknowledge turns it never carried.
  const path = transcript([
    assistant(),
    assistant({ messageId: 'msg_agent', agentId: 'agent-7' }),
  ])

  const [{ payload }] = await buildPayloads({
    transcriptPath: path,
    sessionId: 'session-1',
    cwd: '/home/dev/api',
    environment: {},
  })

  expect(payload.reports[0].turns.map((turn) => turn.messageId)).toEqual([
    'msg_1',
  ])
})

test('a session that produced no turn of its own is not a report', async () => {
  // A session killed before the first response, or a file that belongs to
  // another session entirely. An empty report would be a request the route
  // refuses for carrying no cursor.
  const path = transcript([assistant({ sessionId: 'somebody-else' })])

  expect(
    await buildPayloads({
      transcriptPath: path,
      sessionId: 'session-1',
      cwd: '/home/dev/api',
      environment: {},
    }),
  ).toEqual([])
})

test('the Project is keyed by the directory the turns ran in', async () => {
  const path = transcript([assistant({ cwd: '/home/dev/elsewhere' })])

  const [{ payload }] = await buildPayloads({
    transcriptPath: path,
    sessionId: 'session-1',
    // The event says where the session started; the entry says where it ran.
    cwd: '/home/dev/api',
    environment: {},
  })

  expect(payload.reports[0].project.key).toContain('/home/dev/elsewhere')
  expect(payload.reports[0].project.remote).toBeNull()
})

test('a directory that is not a repository has no remote, and does not throw', async () => {
  expect(
    await originRemote(mkdtempSync(join(tmpdir(), 'sessclone-bare-'))),
  ).toBeNull()
  // A directory that does not exist at all: `git` fails to start rather than
  // failing, which is a different throw and the same answer.
  expect(await originRemote('/nowhere/at/all')).toBeNull()
  expect(await originRemote(undefined)).toBeNull()
})

test('a session past the wire limit is chunked, not refused forever', async () => {
  // The limit the route validates against. A single report over it is a 400,
  // `send` has nobody to tell, and the next Stop re-reads the same file for
  // the same answer — so every Turn of the longest-running sessions would be
  // lost for good. `--resume` appends to one file (finding 03), so this is
  // reached by accumulation rather than by anything exotic.
  const lines = Array.from({ length: TURNS_PER_REPORT + 10 }, (_, at) =>
    assistant({ messageId: `msg_${at}` }),
  )
  const path = transcript(lines)

  const [{ payload }] = await buildPayloads({
    transcriptPath: path,
    sessionId: 'session-1',
    cwd: '/home/dev/api',
    environment: {},
  })

  expect(payload.reports).toHaveLength(2)
  expect(payload.reports[0].turns).toHaveLength(TURNS_PER_REPORT)
  expect(payload.reports[1].turns).toHaveLength(10)
  expect(IngestPayload.safeParse(payload).success).toBe(true)

  // Only the report that read to the end of the file acknowledges a position.
  expect(payload.reports[0].cursor.byteOffset).toBe(0)
  expect(payload.reports[1].cursor.byteOffset).toBeGreaterThan(0)
})

test('a session that moved between repositories reports each Project’s own turns', async () => {
  // Finding 74: a session moves between repositories mid-run. Keyed by the
  // last Turn's directory, the earlier ones are filed against a repository
  // they never ran in — and `on conflict do nothing` then freezes that.
  const path = transcript([
    assistant({ messageId: 'msg_api', cwd: '/home/dev/api' }),
    assistant({ messageId: 'msg_site', cwd: '/home/dev/site' }),
    assistant({ messageId: 'msg_api_2', cwd: '/home/dev/api' }),
  ])

  const [{ payload }] = await buildPayloads({
    transcriptPath: path,
    sessionId: 'session-1',
    cwd: '/home/dev/api',
    environment: {},
  })

  expect(payload.reports).toHaveLength(2)
  const byKey = new Map(
    payload.reports.map((report) => [
      report.project.key,
      report.turns.map((turn) => turn.messageId),
    ]),
  )
  expect(
    [...byKey.values()].toSorted((a, b) => a[0].localeCompare(b[0])),
  ).toEqual([['msg_api', 'msg_api_2'], ['msg_site']])
  expect(
    payload.reports.every((report) => report.sessionId === 'session-1'),
  ).toBe(true)
})

test('the API key is not in the environment `git` runs with', async () => {
  // `execFile` hands a child `process.env` by default, and `git` here is
  // resolved through `PATH` and run in a directory the transcript named — so
  // a shim, or a `git.exe` in a cloned repository, would be handed a live
  // credential.
  const directory = mkdtempSync(join(tmpdir(), 'sessclone-git-'))
  const dump = join(directory, 'environment.txt')
  writeFileSync(
    join(directory, 'git'),
    `#!/bin/sh\nenv > ${dump}\necho git@github.com:acme/api.git\n`,
    { mode: 0o755 },
  )

  const remote = await originRemote(directory, {
    PATH: directory,
    HOME: directory,
    SESSCLONE_API_KEY: `sk_${'a'.repeat(43)}`,
  })

  expect(remote).toBe('git@github.com:acme/api.git')
  expect(readFileSync(dump, 'utf8')).not.toContain('sk_')
})

test('a Node too old to read the shared modules fails quietly', async () => {
  // `packages/shared` is TypeScript the hooks import directly, which a Node
  // below 22.18 cannot load. Imported at the top of `stop.mjs` that throws
  // before any handler exists: a hook error notice on every turn, and the
  // stack trace on stderr — which lands in the next transcript, the one this
  // product uploads. `--no-experimental-strip-types` is that Node, here.
  const hook = new URL('../hooks/stop.mjs', import.meta.url)
  const child = execFile('node', [
    '--no-experimental-strip-types',
    hook.pathname,
  ])
  child.stdin?.end(
    JSON.stringify({ session_id: 'session-1', transcript_path: '/nowhere' }),
  )

  const finished = await new Promise((resolve) => {
    let stderr = ''
    child.stderr?.on('data', (chunk) => (stderr += chunk))
    child.on('close', (code) => resolve({ code, stderr }))
  })

  expect(finished.stderr).toBe('')
  expect(finished.code).toBe(0)
})
