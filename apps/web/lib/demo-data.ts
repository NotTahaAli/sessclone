import { createHash } from 'node:crypto'

// Ticket 137: the demo's made-up usage, generated rather than recorded.
//
// Pure: every value is drawn from a PRNG seeded by a hash of what it
// describes — an Org's team from the Org, a day's Sessions from (Org, date) —
// so the data looks random, differs per Org, and is the same every time it is
// generated. That is what makes the daily refresh idempotent (a day seeded
// twice is the same rows, which the identity keys then ignore) and what lets
// the tests pin it down.
//
// Nothing here is real: names, repositories and transcripts are invented, and
// the transcripts quote no real code and no secret.

/** How many days of demo data are kept, today included. */
export const DEMO_DAYS = 60

/** A demo day's activity ends by this UTC hour, so a day is seeded once this
 * has passed (the daily cron runs in the hour after it) and a visitor never
 * sees a Turn in the future. */
export const DAY_ENDS_HOUR = 23

const digest = (label: string) => createHash('sha256').update(label).digest()

/** A stable uuid (v4-shaped) for a label: the same label, the same id. */
export const demoId = (label: string) => {
  const bytes = digest(label).subarray(0, 16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const hex = (label: string, length: number) =>
  digest(label).toString('hex').slice(0, length)

/** mulberry32, seeded from the label's hash: uniform in [0, 1). */
export const prng = (label: string) => {
  let state = digest(label).readUInt32LE(0)
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

type Random = () => number

const int = (random: Random, min: number, max: number) =>
  min + Math.floor(random() * (max - min + 1))

const pick = <T>(random: Random, items: readonly T[]): T =>
  items[Math.floor(random() * items.length)]!

const weighted = <T>(random: Random, items: readonly [T, number][]): T => {
  const total = items.reduce((sum, [, weight]) => sum + weight, 0)
  let at = random() * total
  for (const [item, weight] of items) {
    at -= weight
    if (at < 0) return item
  }
  return items.at(-1)![0]
}

const shuffled = <T>(random: Random, items: readonly T[]): T[] => {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j]!, copy[i]!]
  }
  return copy
}

// ---------------------------------------------------------------------------
// The two Orgs, and who is in them.

export type DemoRole = 'owner' | 'admin' | 'manager' | 'member'

export type DemoOrgSpec = {
  key: string
  name: string
  /** The visitor's Role here: Owner of one, Member of the other (Taha). */
  visitorRole: 'owner' | 'member'
  /** Older first: with no switcher choice the oldest working Org opens. */
  createdAt: string
  repos: readonly string[]
  models: readonly string[]
}

export const DEMO_ORGS: readonly DemoOrgSpec[] = [
  {
    key: 'northwind',
    name: 'Northwind Robotics',
    visitorRole: 'owner',
    createdAt: '2026-01-05T09:00:00Z',
    repos: ['firmware', 'fleet-console', 'motion-planner', 'sim', 'infra'],
    models: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
  },
  {
    key: 'harbor',
    name: 'Harbor Health',
    visitorRole: 'member',
    createdAt: '2026-02-11T09:00:00Z',
    repos: ['patient-portal', 'claims-api', 'design-system', 'data-pipeline'],
    models: ['claude-sonnet-5', 'claude-opus-4-8', 'claude-fable-5'],
  },
]

/** The visitor, in every demo Org. */
export const VISITOR_NAME = 'Alex Morgan'

const FIRST = [
  'Maya',
  'Jonas',
  'Priya',
  'Tomás',
  'Aiko',
  'Femi',
  'Lena',
  'Ravi',
  'Sofia',
  'Dmitri',
  'Grace',
  'Omar',
  'Hana',
  'Lucas',
  'Zara',
  'Mateo',
  'Ingrid',
  'Kwame',
  'Elif',
  'Noah',
] as const
const LAST = [
  'Chen',
  'Okafor',
  'Lindqvist',
  'Rossi',
  'Tanaka',
  'Haddad',
  'Novak',
  'Fischer',
  'Mensah',
  'Ibarra',
  'Kowalski',
  'Nair',
  'Brennan',
  'Sato',
  'Duarte',
  'Varga',
  'Adeyemi',
  'Holm',
  'Petrov',
  'Quinn',
] as const
const DEVICES = [
  'MacBook Pro',
  'ThinkPad X1',
  'Linux workstation',
  'Mac Studio',
] as const

export type DemoDevice = { id: string; key: string; nickname: string }

export type DemoPerson = {
  userId: string
  memberId: string
  name: string
  email: string
  role: DemoRole
  visitor: boolean
  /** Mean Sessions on a weekday. */
  sessionsPerDay: number
  /** The model this person reaches for first. */
  model: string
  devices: DemoDevice[]
}

export type DemoProject = { id: string; key: string; weight: number }

export type DemoOrg = {
  spec: DemoOrgSpec
  id: string
  team: DemoPerson[]
  projects: DemoProject[]
}

/**
 * An Org and its team of six: the visitor and five invented people, with
 * Roles, habits, devices and Projects drawn from the Org's own seed.
 */
export const demoOrg = (spec: DemoOrgSpec, visitorUserId: string): DemoOrg => {
  const random = prng(`org:${spec.key}`)
  const id = demoId(`org:${spec.key}`)
  const slug = spec.key

  const firsts = shuffled(random, FIRST)
  const lasts = shuffled(random, LAST)
  const others: DemoRole[] =
    spec.visitorRole === 'owner'
      ? ['admin', 'manager', 'member', 'member', 'member']
      : ['owner', 'admin', 'member', 'member', 'member']

  const person = (
    index: number,
    name: string,
    role: DemoRole,
    visitor: boolean,
  ): DemoPerson => {
    const memberId = demoId(`member:${spec.key}:${index}`)
    const count = int(random, 1, 2)
    return {
      userId: visitor ? visitorUserId : demoId(`user:${spec.key}:${index}`),
      memberId,
      name,
      email: visitor
        ? ''
        : `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@${slug}.demo.invalid`,
      role,
      visitor,
      sessionsPerDay: 1.5 + random() * 3,
      model: weighted(
        random,
        spec.models.map((model, rank): [string, number] => [model, 3 - rank]),
      ),
      devices: Array.from({ length: count }, (_, n) => ({
        id: demoId(`device:${spec.key}:${index}:${n}`),
        key: `demo-${hex(`device:${spec.key}:${index}:${n}`, 12)}`,
        nickname: n === 0 ? pick(random, DEVICES) : 'Cloud session',
      })),
    }
  }

  const team = [
    person(0, VISITOR_NAME, spec.visitorRole, true),
    ...others.map((role, n) =>
      person(n + 1, `${firsts[n]} ${lasts[n]}`, role, false),
    ),
  ]

  const projects = shuffled(random, spec.repos)
    .slice(0, int(random, 3, spec.repos.length))
    .map((repo, rank) => ({
      id: demoId(`project:${spec.key}:${repo}`),
      key: `github.com/${slug}/${repo}`,
      weight: 1 / (rank + 1),
    }))

  return { spec, id, team, projects }
}

// ---------------------------------------------------------------------------
// Days.

/** `YYYY-MM-DD` of an instant, in UTC. */
export const utcDate = (at: Date) => at.toISOString().slice(0, 10)

const addDays = (date: string, days: number) => {
  const at = new Date(`${date}T00:00:00Z`)
  at.setUTCDate(at.getUTCDate() + days)
  return utcDate(at)
}

/** The oldest instant kept: the start of the first day of the window. */
export const demoCutoff = (now: Date) =>
  new Date(`${addDays(utcDate(now), 1 - DEMO_DAYS)}T00:00:00Z`)

/**
 * The days that should hold data at `now`, oldest first: the last
 * `DEMO_DAYS` UTC days, today included once its activity has ended.
 */
export const demoWindow = (now: Date): string[] => {
  const today = utcDate(now)
  const days: string[] = []
  for (let back = DEMO_DAYS - 1; back >= 0; back--) {
    const day = addDays(today, -back)
    const ends = new Date(
      `${day}T${String(DAY_ENDS_HOUR).padStart(2, '0')}:00:00Z`,
    )
    if (ends <= now) days.push(day)
  }
  return days
}

// ---------------------------------------------------------------------------
// One day's Sessions.

export type DemoTurn = {
  agentId: string | null
  messageId: string
  occurredAt: Date
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  thinkingTokens: number
  webSearchRequests: number
  spawnDepth: number | null
}

export type DemoFailure = { at: Date; errorType: string; message: string }

export type DemoSession = {
  memberId: string
  deviceId: string
  projectId: string
  projectKey: string
  sessionId: string
  startedAt: Date
  endedAt: Date | null
  turns: DemoTurn[]
  failure: DemoFailure | null
  /** Whether this Session's transcript is stored (a few, to stay small). */
  transcript: boolean
}

const FAILURES = [
  ['overloaded', 'API Error: 529 Overloaded'],
  ['rate_limit', 'API Error: 429 rate limit exceeded'],
] as const

/** Days since the epoch, for the every-few-days transcript rule. */
const dayNumber = (date: string) =>
  Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000)

/** A transcript is stored for the visitor's first Session every this many
 * days, per Org: about fifteen objects each across the window. */
export const TRANSCRIPT_EVERY = 4

/**
 * Every Session of one Org on one UTC day, with its Turns. Weekends are
 * quiet; the visitor works every weekday, so both of their views have data.
 */
export const demoDay = (org: DemoOrg, date: string): DemoSession[] => {
  const random = prng(`day:${org.spec.key}:${date}`)
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
  const weekend = weekday === 0 || weekday === 6
  const withTranscript = dayNumber(date) % TRANSCRIPT_EVERY === 0
  const projects = org.projects.map((p): [DemoProject, number] => [p, p.weight])
  const sessions: DemoSession[] = []

  for (const person of org.team) {
    const mean = person.sessionsPerDay * (weekend ? 0.2 : 1)
    let count = Math.floor(mean + random())
    if (person.visitor && !weekend) count = Math.max(count, 1)

    for (let k = 0; k < count; k++) {
      const label = `${org.spec.key}:${date}:${person.memberId}:${k}`
      const transcript = withTranscript && person.visitor && k === 0
      const project = weighted(random, projects)
      const device =
        person.devices.length > 1 && random() < 0.25
          ? person.devices[1]!
          : person.devices[0]!
      // 07:00 to 19:00 UTC, so even a long Session ends before DAY_ENDS_HOUR.
      const startedAt = new Date(
        Date.parse(`${date}T07:00:00Z`) + Math.floor(random() * 12 * 3_600_000),
      )
      const model =
        random() < 0.75 ? person.model : pick(random, org.spec.models)
      // A stored transcript is kept short, so the objects stay small.
      const length = transcript ? int(random, 8, 12) : int(random, 10, 80)

      const turns: DemoTurn[] = []
      let at = startedAt.getTime()
      let context = int(random, 9_000, 24_000)
      for (let i = 0; i < length; i++) {
        at += int(random, 12, 110) * 1000 + (random() < 0.08 ? 600_000 : 0)
        const created = i === 0 ? context : int(random, 300, 5_200)
        const output = int(random, 60, 1_900)
        turns.push({
          agentId: null,
          messageId: `msg_demo_${hex(`${label}:${i}`, 20)}`,
          occurredAt: new Date(at),
          model,
          inputTokens: int(random, 1, 40),
          outputTokens: output,
          cacheReadInputTokens: i === 0 ? 0 : context,
          cacheCreationInputTokens: created,
          thinkingTokens:
            random() < 0.4 ? Math.floor(output * random() * 0.5) : 0,
          webSearchRequests: random() < 0.03 ? 1 : 0,
          spawnDepth: null,
        })
        if (i > 0) context = Math.min(context + created, 190_000)
      }

      // Subagents: a few Sessions hand work to an Agent Run on a cheaper
      // model. Never in a stored transcript, which has no Agent Run beside it.
      const agents = !transcript && random() < 0.2 ? int(random, 1, 2) : 0
      for (let a = 0; a < agents; a++) {
        const agentId = `a${hex(`${label}:agent:${a}`, 16)}`
        const agentModel =
          random() < 0.6 ? 'claude-haiku-4-5' : 'claude-sonnet-5'
        let agentAt =
          turns[int(random, 0, turns.length - 1)]!.occurredAt.getTime()
        let agentContext = int(random, 4_000, 12_000)
        for (let i = 0, n = int(random, 4, 14); i < n; i++) {
          agentAt += int(random, 5, 40) * 1000
          const created = i === 0 ? agentContext : int(random, 200, 3_000)
          turns.push({
            agentId,
            messageId: `msg_demo_${hex(`${label}:agent:${a}:${i}`, 20)}`,
            occurredAt: new Date(agentAt),
            model: agentModel,
            inputTokens: int(random, 1, 20),
            outputTokens: int(random, 40, 900),
            cacheReadInputTokens: i === 0 ? 0 : agentContext,
            cacheCreationInputTokens: created,
            thinkingTokens: 0,
            webSearchRequests: 0,
            spawnDepth: 1,
          })
          if (i > 0) agentContext += created
        }
      }
      turns.sort((x, y) => x.occurredAt.getTime() - y.occurredAt.getTime())

      const last = turns.at(-1)!.occurredAt
      const failed = !transcript && random() < 0.04
      const [errorType, message] = pick(random, FAILURES)
      sessions.push({
        memberId: person.memberId,
        deviceId: device.id,
        projectId: project.id,
        projectKey: project.key,
        sessionId: demoId(`session:${label}`),
        startedAt,
        // Most end cleanly; a cloud Session never reports an end, and neither
        // does one that failed.
        endedAt:
          failed || device.nickname === 'Cloud session'
            ? null
            : new Date(last.getTime() + 20_000),
        turns,
        failure: failed
          ? { at: new Date(last.getTime() + 5_000), errorType, message }
          : null,
        transcript,
      })
    }
  }
  return sessions
}

// ---------------------------------------------------------------------------
// Transcripts.

type Step =
  | { text: string }
  | { tool: string; input: Record<string, unknown>; result: string }

type Scenario = { prompt: string; steps: Step[] }

/** Invented work: plausible, generic, and quoting no real code. */
const SCENARIOS: readonly Scenario[] = [
  {
    prompt:
      'The retry test in the scheduler is flaky on CI. Can you find out why and fix it?',
    steps: [
      { text: 'I will start by reading the test and the code it exercises.' },
      {
        tool: 'Grep',
        input: { pattern: 'retryWithBackoff', path: 'src' },
        result: 'src/scheduler/retry.ts\nsrc/scheduler/retry.test.ts',
      },
      {
        tool: 'Read',
        input: { file_path: 'src/scheduler/retry.test.ts' },
        result:
          '(42 lines) The test waits a fixed 50ms for the second attempt.',
      },
      {
        tool: 'Read',
        input: { file_path: 'src/scheduler/retry.ts' },
        result:
          '(88 lines) Backoff adds up to 30ms of jitter to a 40ms base delay.',
      },
      {
        text: 'Found it: the base delay plus jitter can exceed the fixed 50ms wait, so the assertion races the timer. I will switch the test to fake timers.',
      },
      {
        tool: 'Edit',
        input: {
          file_path: 'src/scheduler/retry.test.ts',
          old_string: 'await sleep(50)',
          new_string: 'await vi.advanceTimersByTimeAsync(100)',
        },
        result: 'The file has been updated.',
      },
      {
        tool: 'Bash',
        input: { command: 'pnpm vitest run src/scheduler --repeat 20' },
        result: 'Test Files  1 passed (1)\n     Tests  120 passed (120)',
      },
      {
        text: 'Fixed. The test now drives the clock itself, so jitter can no longer outrun it; 20 repeated runs pass.',
      },
    ],
  },
  {
    prompt:
      'Add pagination to the devices list endpoint. Keep the response shape backwards compatible.',
    steps: [
      { text: 'Let me look at the current handler and its tests first.' },
      {
        tool: 'Read',
        input: { file_path: 'src/api/devices.ts' },
        result: '(61 lines) Returns every device for the account in one array.',
      },
      {
        tool: 'Read',
        input: { file_path: 'src/api/devices.test.ts' },
        result: '(35 lines) Two tests: empty list and three devices.',
      },
      {
        text: 'I will add an optional cursor and limit, return `next` beside the existing `devices` array, and default to the old behaviour when neither is sent.',
      },
      {
        tool: 'Edit',
        input: {
          file_path: 'src/api/devices.ts',
          old_string: 'const devices = await listDevices(account)',
          new_string:
            'const { devices, next } = await listDevices(account, page)',
        },
        result: 'The file has been updated.',
      },
      {
        tool: 'Write',
        input: {
          file_path: 'src/api/devices.test.ts',
          content: '// three new tests: first page, next page, last page',
        },
        result: 'File written.',
      },
      {
        tool: 'Bash',
        input: { command: 'pnpm test src/api' },
        result: 'Tests  7 passed (7)',
      },
      {
        text: 'Done: `?limit=` and `?cursor=` are optional, responses gain a `next` field, and old clients see the same array as before.',
      },
    ],
  },
  {
    prompt:
      'Write a short README section explaining how to run the simulator locally.',
    steps: [
      {
        tool: 'Glob',
        input: { pattern: 'sim/**/*.md' },
        result: 'sim/README.md',
      },
      {
        tool: 'Read',
        input: { file_path: 'sim/README.md' },
        result: '(20 lines) An overview with no setup steps.',
      },
      {
        tool: 'Bash',
        input: { command: 'cat sim/package.json | head -20' },
        result: '"scripts": { "dev": "vite", "sim": "node run.js --headless" }',
      },
      {
        text: 'The simulator has a headless mode and a dev server. I will document both, with the prerequisites.',
      },
      {
        tool: 'Edit',
        input: {
          file_path: 'sim/README.md',
          old_string: '## Overview',
          new_string:
            '## Running locally\n\n1. `pnpm install`\n2. `pnpm sim` for a headless run, or `pnpm dev` for the viewer.\n\n## Overview',
        },
        result: 'The file has been updated.',
      },
      {
        text: 'Added a "Running locally" section covering install, the headless run and the viewer.',
      },
    ],
  },
  {
    prompt: 'The claims export job is slow. Profile it and suggest a fix.',
    steps: [
      {
        text: 'I will time the job on the sample data set before changing anything.',
      },
      {
        tool: 'Bash',
        input: { command: 'time pnpm export:claims --sample' },
        result: 'real 0m41.2s',
      },
      {
        tool: 'Grep',
        input: { pattern: 'for .* of claims', path: 'src/export' },
        result: 'src/export/claims.ts:57',
      },
      {
        tool: 'Read',
        input: { file_path: 'src/export/claims.ts' },
        result:
          "(140 lines) Line 57 loads each claim's line items with its own query.",
      },
      {
        text: 'The export runs one query per claim to fetch line items: 4,800 round trips on the sample. Loading them in one query grouped by claim should remove almost all of the time.',
      },
      {
        tool: 'Edit',
        input: {
          file_path: 'src/export/claims.ts',
          old_string: 'for (const claim of claims) {',
          new_string:
            'const items = await lineItemsFor(claims.map((c) => c.id))\nfor (const claim of claims) {',
        },
        result: 'The file has been updated.',
      },
      {
        tool: 'Bash',
        input: { command: 'time pnpm export:claims --sample' },
        result: 'real 0m3.9s',
      },
      {
        text: 'From 41s to 3.9s on the sample: the per-claim query is now a single batched read. Output is byte-identical to the previous run.',
      },
    ],
  },
]

const iso = (at: number) => new Date(at).toISOString()

/** The checks a careful Session runs before it says it is done, used when a
 * Session has more Turns than its scenario has steps. */
const CHECKS: readonly Step[] = [
  {
    tool: 'Bash',
    input: { command: 'git diff --stat' },
    result: ' 2 files changed, 31 insertions(+), 9 deletions(-)',
  },
  {
    tool: 'Bash',
    input: { command: 'pnpm lint' },
    result: 'Found 0 warnings and 0 errors.',
  },
  {
    tool: 'Bash',
    input: { command: 'pnpm typecheck' },
    result: 'Done in 6.2s',
  },
  {
    text: 'Lint and types are clean. One more full test run before I wrap up.',
  },
  {
    tool: 'Bash',
    input: { command: 'pnpm test' },
    result: 'Test Files  48 passed (48)\n     Tests  611 passed (611)',
  },
  {
    tool: 'Bash',
    input: { command: 'git status --short' },
    result: ' M 2 files',
  },
]

/**
 * A stored transcript for one Session, in the JSONL Claude Code writes and
 * `packages/shared/src/transcript` reads. Each Turn is one assistant message
 * whose id and usage are that Turn's, so the viewer's costs join up.
 */
export const demoTranscript = (session: DemoSession): string => {
  const scenario =
    SCENARIOS[digest(session.sessionId).readUInt8(0) % SCENARIOS.length]!
  const repo = session.projectKey.split('/').pop()!
  const base = {
    isSidechain: false,
    sessionId: session.sessionId,
    cwd: `/home/dev/${repo}`,
    gitBranch: 'main',
    version: '2.1.280',
  }
  const lines: unknown[] = []
  let n = 0
  const uuid = () => demoId(`${session.sessionId}:line:${n++}`)
  const start = session.startedAt.getTime()

  lines.push({
    type: 'queue-operation',
    operation: 'enqueue',
    timestamp: iso(start),
    sessionId: session.sessionId,
    content: scenario.prompt,
  })
  lines.push({
    ...base,
    type: 'user',
    uuid: uuid(),
    timestamp: iso(start + 500),
    message: { role: 'user', content: scenario.prompt },
  })

  const turns = session.turns.filter((turn) => turn.agentId === null)
  // The scenario's work, then checks if there are Turns to spare, then its
  // closing sentence on the last Turn.
  const steps = [...scenario.steps.slice(0, -1), ...CHECKS]
    .slice(0, turns.length - 1)
    .concat(scenario.steps.at(-1)!)
  turns.forEach((turn, index) => {
    const lastTurn = index === turns.length - 1
    const step = steps[index]!
    const at = turn.occurredAt.getTime()
    const usage = {
      input_tokens: turn.inputTokens,
      output_tokens: turn.outputTokens,
      cache_read_input_tokens: turn.cacheReadInputTokens,
      cache_creation_input_tokens: turn.cacheCreationInputTokens,
    }
    const message = (content: unknown[], stop: string) => ({
      ...base,
      type: 'assistant',
      uuid: uuid(),
      timestamp: iso(at),
      requestId: `req_${turn.messageId}`,
      message: {
        model: turn.model,
        id: turn.messageId,
        type: 'message',
        role: 'assistant',
        content,
        stop_reason: stop,
        stop_sequence: null,
        usage,
      },
    })
    if ('text' in step) {
      lines.push(
        message(
          [{ type: 'text', text: step.text }],
          lastTurn ? 'end_turn' : 'tool_use',
        ),
      )
      return
    }
    const toolUseId = `toolu_${hex(`${turn.messageId}:tool`, 20)}`
    lines.push(
      message(
        [
          {
            type: 'tool_use',
            id: toolUseId,
            name: step.tool,
            input: step.input,
          },
        ],
        'tool_use',
      ),
    )
    lines.push({
      ...base,
      type: 'user',
      uuid: uuid(),
      timestamp: iso(at + 1_500),
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: toolUseId, content: step.result },
        ],
      },
    })
  })

  return `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`
}
