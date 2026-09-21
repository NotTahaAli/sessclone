import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from 'vitest'

import { buildPayload, originRemote } from './report.mjs'

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

  const payload = await buildPayload({
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
  expect(report.turns.map((turn) => turn.messageId)).toEqual([
    'msg_1',
    'msg_2',
  ])
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

  const payload = await buildPayload({
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
    await buildPayload({
      transcriptPath: path,
      sessionId: 'session-1',
      cwd: '/home/dev/api',
      environment: {},
    }),
  ).toBeNull()
})

test('the Project is keyed by the directory the turns ran in', async () => {
  const path = transcript([assistant({ cwd: '/home/dev/elsewhere' })])

  const payload = await buildPayload({
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
  expect(await originRemote(mkdtempSync(join(tmpdir(), 'sessclone-bare-')))).toBeNull()
  // A directory that does not exist at all: `git` fails to start rather than
  // failing, which is a different throw and the same answer.
  expect(await originRemote('/nowhere/at/all')).toBeNull()
  expect(await originRemote(undefined)).toBeNull()
})
