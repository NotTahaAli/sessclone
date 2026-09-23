import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { expect, test } from 'vitest'

import {
  configDirectory,
  sessionFiles,
  sessionTranscripts,
} from './transcripts.mjs'
import { buildPayloads } from './report.mjs'

// Tickets 35 and 36, against the layout the corpus was captured from:
//
//   <config>/projects/<sanitised-cwd>/<sessionId>.jsonl
//   <config>/projects/<sanitised-cwd>/<sessionId>/subagents/agent-<id>.jsonl
//   <config>/projects/<sanitised-cwd>/<sessionId>/subagents/agent-<id>.meta.json
//
// The fixtures are the real files: `agent-run.jsonl` and
// `workflow-agent-run.jsonl` are two runs of one parent Session, so a
// workflow's run is not a special case here and the test says so by using it.

const CORPUS = new URL('../../shared/fixtures/transcripts/', import.meta.url)
const SESSION = '456e47f6-e387-59c4-b84c-21c031bb3504'

const fixture = (name) => readFile(new URL(name, CORPUS), 'utf8')

/** A config directory holding one Session and the runs it spawned. */
const layout = async ({
  runs = [],
  directory = '-home-user-sessclone',
} = {}) => {
  const config = mkdtempSync(join(tmpdir(), 'sessclone-claude-'))
  const project = join(config, 'projects', directory)
  mkdirSync(project, { recursive: true })

  const main = join(project, `${SESSION}.jsonl`)
  // The Session fixture was captured under its own id; it is the parent here,
  // so its entries name this file's id — which is what Claude Code writes.
  const captured = await fixture('multi-iteration-turn.jsonl')
  const own = JSON.parse(captured.split('\n').find(Boolean)).sessionId
  writeFileSync(main, captured.replaceAll(own, SESSION))

  const subagents = join(project, SESSION, 'subagents')
  mkdirSync(subagents, { recursive: true })
  await Promise.all(
    runs.map(async ({ name, agentId, meta }) => {
      writeFileSync(
        join(subagents, `agent-${agentId}.jsonl`),
        await fixture(name),
      )
      if (meta !== undefined) {
        writeFileSync(
          join(subagents, `agent-${agentId}.meta.json`),
          JSON.stringify(meta),
        )
      }
    }),
  )

  return { config, main, project }
}

test('a Session’s Agent Runs are found beside it, workflow runs included', async () => {
  const { config, main } = await layout({
    runs: [
      {
        name: 'agent-run.jsonl',
        agentId: 'a4a571530bd42856c',
        meta: { spawnDepth: 1 },
      },
      {
        name: 'workflow-agent-run.jsonl',
        agentId: 'a38fc2c136a5f46a3',
        meta: { spawnDepth: 2 },
      },
    ],
  })

  const found = await sessionTranscripts({
    transcriptPath: main,
    sessionId: SESSION,
    environment: { CLAUDE_CONFIG_DIR: config },
  })

  expect(found).toHaveLength(3)
  expect(found.filter((file) => file.agentRun)).toHaveLength(2)
  // Read from the sidecar, not assumed to be one level down.
  expect(
    found
      .filter((file) => file.agentRun)
      .map((file) => file.spawnDepth)
      .toSorted((a, b) => a - b),
  ).toEqual([1, 2])
})

test('a run whose sidecar says nothing reports no depth rather than a guess', async () => {
  const { config, main } = await layout({
    runs: [{ name: 'agent-run.jsonl', agentId: 'a4a571530bd42856c' }],
  })

  const found = await sessionTranscripts({
    transcriptPath: main,
    sessionId: SESSION,
    environment: { CLAUDE_CONFIG_DIR: config },
  })

  expect(found.find((file) => file.agentRun)?.spawnDepth).toBeNull()
})

test('a Session whose working directory changed is collected from both places', async () => {
  // Finding 74: a Projects session moves between repositories mid-run, and the
  // sanitised directory name cannot be reversed — so the id is searched for
  // rather than a path being derived from a `cwd`.
  const { config, main } = await layout({
    runs: [{ name: 'agent-run.jsonl', agentId: 'a4a571530bd42856c' }],
  })
  const elsewhere = join(config, 'projects', '-home-user-other')
  mkdirSync(join(elsewhere, SESSION, 'subagents'), { recursive: true })
  writeFileSync(
    join(elsewhere, SESSION, 'subagents', 'agent-a38fc2c136a5f46a3.jsonl'),
    await fixture('workflow-agent-run.jsonl'),
  )

  const found = await sessionTranscripts({
    transcriptPath: main,
    sessionId: SESSION,
    environment: { CLAUDE_CONFIG_DIR: config },
  })

  expect(found.map((file) => file.path)).toContain(
    join(elsewhere, SESSION, 'subagents', 'agent-a38fc2c136a5f46a3.jsonl'),
  )
})

test('another Session’s transcripts are not this Session’s', async () => {
  const { config, main, project } = await layout()
  mkdirSync(
    join(project, 'de305d54-75b4-431b-adb2-eb6b9e546014', 'subagents'),
    {
      recursive: true,
    },
  )
  writeFileSync(
    join(
      project,
      'de305d54-75b4-431b-adb2-eb6b9e546014',
      'subagents',
      'agent-x.jsonl',
    ),
    await fixture('agent-run.jsonl'),
  )
  writeFileSync(
    join(project, 'de305d54-75b4-431b-adb2-eb6b9e546014.jsonl'),
    await fixture('agent-run.jsonl'),
  )

  const found = await sessionTranscripts({
    transcriptPath: main,
    sessionId: SESSION,
    environment: { CLAUDE_CONFIG_DIR: config },
  })

  expect(found.map((file) => file.path)).toEqual([main])
})

test('each Agent Run is reported under its own id, against its parent Session', async () => {
  const { config, main } = await layout({
    runs: [
      {
        name: 'agent-run.jsonl',
        agentId: 'a4a571530bd42856c',
        meta: { spawnDepth: 1 },
      },
      {
        name: 'workflow-agent-run.jsonl',
        agentId: 'a38fc2c136a5f46a3',
        meta: { spawnDepth: 2 },
      },
    ],
  })

  const [{ payload }] = await buildPayloads({
    transcriptPath: main,
    sessionId: SESSION,
    cwd: '/home/user/sessclone',
    environment: { CLAUDE_CONFIG_DIR: config },
    stateDir: mkdtempSync(join(tmpdir(), 'sessclone-state-')),
  })

  // Every report is this Session's; the runs are told apart by `agentId`, and
  // that comes from the run's own entries rather than from its filename.
  expect(payload.reports.every((report) => report.sessionId === SESSION)).toBe(
    true,
  )
  expect(payload.reports.map((report) => report.agentId).toSorted()).toEqual([
    'a38fc2c136a5f46a3',
    'a4a571530bd42856c',
    null,
  ])

  const depths = new Map(
    payload.reports.map((report) => [
      report.agentId,
      report.turns.map((turn) => turn.spawnDepth),
    ]),
  )
  expect(depths.get(null).every((depth) => depth === null)).toBe(true)
  expect(depths.get('a4a571530bd42856c').every((depth) => depth === 1)).toBe(
    true,
  )
  expect(depths.get('a38fc2c136a5f46a3').every((depth) => depth === 2)).toBe(
    true,
  )
})

test('the config directory follows CLAUDE_CONFIG_DIR, then HOME', () => {
  expect(configDirectory({ CLAUDE_CONFIG_DIR: '/opt/claude' })).toBe(
    '/opt/claude',
  )
  expect(configDirectory({ HOME: '/home/dev' })).toBe('/home/dev/.claude')
  expect(configDirectory({ CLAUDE_CONFIG_DIR: '  ', HOME: '/home/dev' })).toBe(
    '/home/dev/.claude',
  )
})

test('a sidecar that states a depth badly states none', async () => {
  // `spawnDepth` is validated as a non-negative integer at the route, so a
  // sidecar carrying `"1"` or `1.5` would 400 the whole payload — every Turn
  // in it, on every Stop, until somebody edited a file they never wrote.
  const depths = await Promise.all(
    [{ spawnDepth: '1' }, { spawnDepth: 1.5 }, { spawnDepth: -1 }, {}].map(
      async (meta) => {
        const { config, main } = await layout({
          runs: [
            { name: 'agent-run.jsonl', agentId: 'a4a571530bd42856c', meta },
          ],
        })

        const found = await sessionTranscripts({
          transcriptPath: main,
          sessionId: SESSION,
          environment: { CLAUDE_CONFIG_DIR: config },
        })

        return found.find((file) => file.agentRun)?.spawnDepth
      },
    ),
  )

  expect(depths).toEqual([null, null, null, null])
})

test('the directory the hook names is searched, whatever the config directory says', async () => {
  // A Member whose `CLAUDE_CONFIG_DIR` this process does not know about. The
  // hook names one real path, and that is enough for the Session and for the
  // runs beside it — the search is a way to find more files, never the only
  // way to find any.
  const { main } = await layout({
    runs: [{ name: 'agent-run.jsonl', agentId: 'a4a571530bd42856c' }],
  })

  const found = await sessionTranscripts({
    transcriptPath: main,
    sessionId: SESSION,
    environment: { CLAUDE_CONFIG_DIR: '/nowhere/at/all' },
  })

  expect(found.map((file) => file.path)).toEqual([
    main,
    join(dirname(main), SESSION, 'subagents', 'agent-a4a571530bd42856c.jsonl'),
  ])
})

test('a workflow’s runs are found a level deeper, under their run id', async () => {
  // The spec's layout, verified live: a workflow's runs sit under
  // `subagents/workflows/<runId>/`, not directly in `subagents/`. A flat
  // listing reports every ordinary run and silently drops every workflow one.
  const { config, main, project } = await layout({
    runs: [{ name: 'agent-run.jsonl', agentId: 'a4a571530bd42856c' }],
  })
  const nested = join(project, SESSION, 'subagents', 'workflows', 'wf_01')
  mkdirSync(nested, { recursive: true })
  writeFileSync(
    join(nested, 'agent-a38fc2c136a5f46a3.jsonl'),
    await fixture('workflow-agent-run.jsonl'),
  )
  writeFileSync(
    join(nested, 'agent-a38fc2c136a5f46a3.meta.json'),
    JSON.stringify({ spawnDepth: 2 }),
  )

  const found = await sessionTranscripts({
    transcriptPath: main,
    sessionId: SESSION,
    environment: { CLAUDE_CONFIG_DIR: config },
  })

  const deeper = found.find((file) => file.path.includes('workflows'))
  expect(deeper).toBeDefined()
  expect(deeper?.agentRun).toBe(true)
  // The sidecar is beside the transcript wherever the transcript is.
  expect(deeper?.spawnDepth).toBe(2)
})

test('each run’s sidecar and each workflow’s journal are found as sidecars, not transcripts', async () => {
  // Ticket 104: the sidecars are archived too, under their own kind — and a
  // workflow's `journal.jsonl` is not an Agent Run's transcript, whatever its
  // extension says.
  const { config, main, project } = await layout({
    runs: [
      {
        name: 'agent-run.jsonl',
        agentId: 'a4a571530bd42856c',
        meta: { spawnDepth: 1 },
      },
    ],
  })
  const nested = join(project, SESSION, 'subagents', 'workflows', 'wf_01')
  mkdirSync(nested, { recursive: true })
  writeFileSync(
    join(nested, 'agent-a38fc2c136a5f46a3.jsonl'),
    await fixture('workflow-agent-run.jsonl'),
  )
  writeFileSync(join(nested, 'agent-a38fc2c136a5f46a3.meta.json'), '{}')
  writeFileSync(join(nested, 'journal.jsonl'), '{"type":"started"}\n')

  const input = {
    transcriptPath: main,
    sessionId: SESSION,
    environment: { CLAUDE_CONFIG_DIR: config },
  }
  const { transcripts, sidecars } = await sessionFiles(input)

  expect(transcripts.map((file) => file.path).toSorted(byText)).toEqual(
    [
      main,
      join(project, SESSION, 'subagents', 'agent-a4a571530bd42856c.jsonl'),
      join(nested, 'agent-a38fc2c136a5f46a3.jsonl'),
    ].toSorted(),
  )
  expect(
    sidecars.map(({ kind, agentId }) => `${kind}:${agentId}`).toSorted(),
  ).toEqual([
    'agent_meta:a38fc2c136a5f46a3',
    'agent_meta:a4a571530bd42856c',
    'workflow_journal:wf_01',
  ])
  // The same list the reporter reads, which must not ingest a journal.
  expect(await sessionTranscripts(input)).toEqual(transcripts)
})

/** @param {string} a @param {string} b */
function byText(a, b) {
  return a.localeCompare(b)
}
