import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from 'vitest'

import { readCursor, writeCursor } from './cursors.mjs'
import { buildPayloads } from './report.mjs'

// Ticket 37: a steady-state report costs a few hundred bytes, and a cursor
// that is lost or damaged costs bandwidth rather than Turns.

const CORPUS = new URL('../../shared/fixtures/transcripts/', import.meta.url)
const SESSION = '456e47f6-e387-59c4-b84c-21c031bb3504'

/** A config directory holding one Session, and a state directory beside it. */
const machine = async () => {
  const config = mkdtempSync(join(tmpdir(), 'sessclone-claude-'))
  const stateDir = mkdtempSync(join(tmpdir(), 'sessclone-state-'))
  const project = join(config, 'projects', '-home-user-sessclone')
  mkdirSync(project, { recursive: true })

  const captured = await readFile(
    new URL('multi-iteration-turn.jsonl', CORPUS),
    'utf8',
  )
  const own = JSON.parse(captured.split('\n').find(Boolean)).sessionId
  const path = join(project, `${SESSION}.jsonl`)
  writeFileSync(path, captured.replaceAll(own, SESSION))

  return { config, stateDir, path, text: captured.replaceAll(own, SESSION) }
}

const report = ({ config, stateDir, path }) =>
  buildPayloads({
    transcriptPath: path,
    sessionId: SESSION,
    cwd: '/home/user/sessclone',
    environment: { CLAUDE_CONFIG_DIR: config },
    stateDir,
  })

/** What a Stop hook does after a request the deployment accepted. */
const acknowledge = (stateDir, plans) =>
  Promise.all(
    plans.flatMap((plan) =>
      plan.advance.map(({ path, cursor }) =>
        writeCursor(stateDir, path, cursor),
      ),
    ),
  )

test('a transcript that has not grown is not reported again', async () => {
  const box = await machine()

  const first = await report(box)
  expect(first).toHaveLength(1)
  await acknowledge(box.stateDir, first)

  // The whole point: no request at all, rather than a request the route
  // absorbs. A Member's steady state is one Stop per turn, forever.
  expect(await report(box)).toEqual([])
})

test('a routine report carries only the Turns past the cursor', async () => {
  const box = await machine()
  const before = await report(box)
  await acknowledge(box.stateDir, before)

  // One more turn, appended the way Claude Code appends one.
  const grown = (await readFile(new URL('agent-run.jsonl', CORPUS), 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const entry = JSON.parse(line)
      entry.sessionId = SESSION
      delete entry.agentId
      entry.uuid = `later-${entry.uuid}`
      if (entry.message?.id) entry.message.id = `later_${entry.message.id}`
      return JSON.stringify(entry)
    })
    .join('\n')
  writeFileSync(box.path, `${box.text}\n${grown}`)

  const [plan] = await report(box)
  const reported = plan.payload.reports.flatMap((one) =>
    one.turns.map((turn) => turn.messageId),
  )
  expect(reported.every((messageId) => messageId.startsWith('later_'))).toBe(
    true,
  )
  // And the cursor it wants acknowledged is the end of the file, not the end
  // of what it happened to read.
  expect(plan.advance[0].cursor.byteOffset).toBe(
    Buffer.byteLength(readFileSync(box.path, 'utf8')),
  )
})

test('a cursor that cannot be trusted re-reports rather than skipping', async () => {
  const box = await machine()
  const first = await report(box)
  const messages = first[0].payload.reports[0].turns.length
  await acknowledge(box.stateDir, first)

  // Half-written, hand-edited, or from a file that was replaced: every one of
  // these is "start from the top", because the alternative is losing Turns.
  const cursors = join(box.stateDir, 'cursors')
  const [name] = readdirSync(cursors)
  const damaged = ['', '{', '{"messageId":"x"}', '{"byteOffset":-1}']

  const again = await Promise.all(
    damaged.map(async (damage) => {
      writeFileSync(join(cursors, name), damage)
      const plans = await report(box)
      return plans[0].payload.reports[0].turns.length
    }),
  )
  expect(again).toEqual(damaged.map(() => messages))
})

test('a transcript replaced by a shorter one is read from the top', async () => {
  const box = await machine()
  await acknowledge(box.stateDir, await report(box))

  // A rotated or restored transcript: the stored offset is past the end of
  // the file now, and trusting it would report nothing ever again.
  const lines = box.text.split('\n').filter(Boolean)
  // Shorter than the stored offset, and still carrying a Turn: the first
  // assistant entries of the same file.
  writeFileSync(box.path, lines.slice(0, 24).join('\n'))

  const [plan] = await report(box)
  expect(plan.payload.reports[0].turns.length).toBeGreaterThan(0)
})

test('a cursor is written atomically and read back', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'sessclone-state-'))
  await writeCursor(stateDir, '/home/dev/api/session.jsonl', {
    messageId: 'msg_1',
    byteOffset: 12,
  })

  expect(await readCursor(stateDir, '/home/dev/api/session.jsonl')).toEqual({
    messageId: 'msg_1',
    byteOffset: 12,
  })
  // Another transcript's cursor is another file.
  expect(await readCursor(stateDir, '/home/dev/site/session.jsonl')).toBeNull()
  // The filename says nothing about where the Member works.
  expect(readdirSync(join(stateDir, 'cursors'))[0]).not.toContain('api')
})

test('an unwritable state directory costs bandwidth, not Turns', async () => {
  // Resolves rather than throwing: a hook that threw here would report
  // nothing at all next time, which is the failure this file exists to avoid.
  // A state directory that is a file: `mkdir` cannot make `cursors` under it.
  const blocked = join(mkdtempSync(join(tmpdir(), 'sessclone-state-')), 'state')
  writeFileSync(blocked, '')

  await expect(
    writeCursor(blocked, '/home/dev/api/session.jsonl', {
      messageId: 'msg_1',
      byteOffset: 12,
    }),
  ).resolves.toBeUndefined()
  expect(await readCursor(blocked, '/home/dev/api/session.jsonl')).toBeNull()
})
