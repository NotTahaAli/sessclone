import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  collect,
  dayOf,
  everyTranscript,
  format,
  formatCount,
  handCount,
  isWsl,
  keyEvidence,
  probeVerdict,
  reconcile,
  redirectTarget,
} from './verify.mjs'

const usage = {
  inputTokens: 1,
  outputTokens: 2,
  cacheReadInputTokens: 3,
  cacheCreationInputTokens: 4,
  cacheCreation5mInputTokens: 4,
  cacheCreation1hInputTokens: 0,
  thinkingTokens: 0,
  webSearchRequests: 0,
  webFetchRequests: 0,
}

const turn = (over = {}) => ({
  sessionId: 'session-1',
  agentId: null,
  messageId: 'msg_1',
  model: 'claude-opus-5',
  serviceTier: null,
  speed: null,
  inferenceGeo: null,
  clientVersion: null,
  timestamp: '2026-09-22T06:00:00.000Z',
  cwd: null,
  gitBranch: null,
  requestId: null,
  complete: true,
  usage,
  entryUuids: [],
  ...over,
})

/** A transcript Claude Code would have written, as the parser expects it. */
const entry = (over = {}) =>
  JSON.stringify({
    uuid: over.uuid ?? 'uuid-1',
    sessionId: over.sessionId ?? 'session-1',
    timestamp: over.timestamp ?? '2026-09-22T06:00:00.000Z',
    type: 'assistant',
    message: {
      id: over.messageId ?? 'msg_1',
      model: over.model ?? 'claude-opus-5',
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 1,
        output_tokens: 2,
        cache_read_input_tokens: 3,
        cache_creation_input_tokens: 4,
      },
    },
  })

describe('keyEvidence', () => {
  it('reports a key by its prefix and length, never by its value', () => {
    const key = `sk_${'a'.repeat(43)}`
    const evidence = keyEvidence(key)

    expect(evidence).toEqual({ set: true, prefix: 'sk_', length: 46 })
    // The whole point of the function: a person pastes this output into a chat.
    expect(JSON.stringify(evidence)).not.toContain(key)
  })

  it('tells an unset key from an empty one', () => {
    expect(keyEvidence(undefined)).toEqual({ set: false })
    expect(keyEvidence('   ')).toEqual({ set: false })
  })
})

describe('isWsl', () => {
  it('reads WSL out of /proc/version', () => {
    expect(
      isWsl('Linux version 5.15.0-microsoft-standard-WSL2 (oe-user@oe-host)'),
    ).toBe(true)
    expect(isWsl('Linux version 6.8.0-45-generic (buildd@lcy02)')).toBe(false)
    expect(isWsl('')).toBe(false)
  })
})

describe('dayOf', () => {
  it('places a timestamp in the Org timezone, not this machine s', () => {
    // 21:00 UTC is already tomorrow in Karachi (+05:00). Ticket 70 reconciles
    // against a dashboard that uses the Org's timezone, so counting this Turn
    // on the UTC day would be a discrepancy with no cause behind it.
    expect(dayOf('2026-09-22T21:00:00.000Z', 'Asia/Karachi')).toBe('2026-09-23')
    expect(dayOf('2026-09-22T21:00:00.000Z', 'UTC')).toBe('2026-09-22')
  })
})

describe('reconcile', () => {
  it('collapses repeats the way the unique index does', () => {
    // The same Turn read twice — a re-swept transcript. `turns_identity_key` is
    // (member, session, agent, message) so the database stores one row, and the
    // dashboard total this is compared against shows one.
    const counted = reconcile([turn(), turn()], {
      day: '2026-09-22',
      timeZone: 'UTC',
    })

    expect(counted.parsed).toBe(2)
    expect(counted.unique).toBe(1)
    expect(counted.duplicates).toBe(1)
    expect(counted.totals.outputTokens).toBe(2)
  })

  it('keeps a Session and its Agent Run apart', () => {
    // Same message id under the same Session, one of them a subagent: the index
    // has `nulls not distinct`, so these are two rows and not one.
    const counted = reconcile([turn(), turn({ agentId: 'agent-9' })], {
      day: '2026-09-22',
      timeZone: 'UTC',
    })

    expect(counted.unique).toBe(2)
  })

  it('excludes other days, and counts undated Turns rather than placing them', () => {
    const counted = reconcile(
      [
        turn(),
        turn({ messageId: 'msg_2', timestamp: '2026-09-21T06:00:00.000Z' }),
        turn({ messageId: 'msg_3', timestamp: null }),
      ],
      { day: '2026-09-22', timeZone: 'UTC' },
    )

    expect(counted.unique).toBe(1)
    expect(counted.undated).toBe(1)
  })

  it('counts every day when no day is asked for', () => {
    const counted = reconcile(
      [turn(), turn({ messageId: 'msg_2', timestamp: '2026-01-02T00:00:00Z' })],
      { day: null, timeZone: 'UTC' },
    )

    expect(counted.unique).toBe(2)
  })

  it('counts each Session separately, because a Device spans containers', () => {
    // Finding 69: in the cloud every container reports under one `cloud:` key,
    // so a Device total covers containers whose transcripts died with them and
    // can never match a hand count run on one machine. The Session is the only
    // unit both sides can name.
    const counted = reconcile(
      [
        turn(),
        turn({ messageId: 'msg_2' }),
        turn({ sessionId: 'session-2', messageId: 'msg_3' }),
      ],
      { day: null, timeZone: 'UTC' },
    )

    expect(counted.bySession).toEqual([
      ['session-1', 2],
      ['session-2', 1],
    ])
  })

  it('marks Turns cut off mid-stream, whose counters are a floor', () => {
    const counted = reconcile([turn({ complete: false })], {
      day: null,
      timeZone: 'UTC',
    })

    expect(counted.incomplete).toBe(1)
  })
})

describe('everyTranscript', () => {
  it('finds subagent transcripts nested below the session directory', async () => {
    // Finding 74: a subagent writes under `<session>/subagents/`, and a
    // workflow's runs one level below that. `allSessions` lists one level and
    // would miss both, which would undercount ticket 70's hand count.
    const config = await mkdtemp(join(tmpdir(), 'verify-'))
    const project = join(config, 'projects', '-home-taha-work')
    await mkdir(join(project, 'session-1', 'subagents', 'run-7'), {
      recursive: true,
    })
    await writeFile(join(project, 'session-1.jsonl'), entry())
    await writeFile(
      join(project, 'session-1', 'subagents', 'agent-1.jsonl'),
      entry(),
    )
    await writeFile(
      join(project, 'session-1', 'subagents', 'run-7', 'agent-2.jsonl'),
      entry(),
    )

    const found = await everyTranscript({ CLAUDE_CONFIG_DIR: config })

    expect(found).toHaveLength(3)
  })
})

describe('handCount', () => {
  it('counts a day off the transcripts on disk', async () => {
    const config = await mkdtemp(join(tmpdir(), 'verify-'))
    const project = join(config, 'projects', '-home-taha-work')
    await mkdir(project, { recursive: true })
    await writeFile(join(project, 'session-1.jsonl'), entry())
    await writeFile(
      join(project, 'session-2.jsonl'),
      entry({ sessionId: 'session-2', messageId: 'msg_2' }),
    )

    const counted = await handCount({
      day: '2026-09-22',
      timeZone: 'UTC',
      environment: { CLAUDE_CONFIG_DIR: config },
    })

    expect(counted.transcripts).toBe(2)
    expect(counted.unique).toBe(2)
    expect(formatCount(counted)).toContain('**2**')
  })
})

describe('collect', () => {
  it('reports the state directory even when the configuration is refused', async () => {
    // A missing key is the commonest state of a machine mid-install, and where
    // the cursor and the queue land is ticket 68's acceptance criterion
    // regardless of whether a key is set yet.
    const config = await mkdtemp(join(tmpdir(), 'verify-'))
    const state = await mkdtemp(join(tmpdir(), 'state-'))

    const report = await collect({
      environment: { CLAUDE_CONFIG_DIR: config, SESSCLONE_STATE_DIR: state },
      platform: 'linux',
      hostname: 'laptop',
      probe: false,
    })

    expect(report.configuration.problems.join(' ')).toContain(
      'SESSCLONE_API_KEY',
    )
    expect(report.state?.path).toBe(state)
    expect(report.state?.writable).toBe(true)
    expect(report.state?.cursors.exists).toBe(false)
  })

  it('resolves the platform default when no state directory is set', async () => {
    const report = await collect({
      environment: { XDG_STATE_HOME: '/xdg' },
      platform: 'linux',
      hostname: 'laptop',
      probe: false,
    })

    expect(report.state?.path).toBe(join('/xdg', 'sessclone'))
  })

  it('prints the Device key every container of an account collapses into', async () => {
    // Ticket 69's "every container collapses into one Device" is this string
    // being equal across containers, so it is printed rather than described.
    const report = await collect({
      environment: {
        CLAUDE_CODE_REMOTE: 'true',
        CLAUDE_CODE_ACCOUNT_UUID: 'account-1',
      },
      platform: 'linux',
      hostname: 'container-abc',
      probe: false,
    })

    expect(report.configuration.deviceKey).toBe('cloud:account-1')
    expect(format(report)).toContain('cloud:account-1')
  })

  it('never puts the key in the rendered report', async () => {
    const key = `sk_${'b'.repeat(43)}`
    const report = await collect({
      environment: { SESSCLONE_API_KEY: key, SESSCLONE_URL: 'https://x.test' },
      platform: 'linux',
      hostname: 'laptop',
      probe: false,
    })

    expect(format(report)).not.toContain(key)
    expect(format(report)).toContain('46 characters')
  })

  it('says when SESSCLONE_URL was defaulted rather than set', async () => {
    // The install guide's quietest failure: a Member who sets only the key
    // reports into their own laptop forever and sees a clean session start.
    const report = await collect({
      environment: { SESSCLONE_API_KEY: `sk_${'c'.repeat(43)}` },
      platform: 'linux',
      hostname: 'laptop',
      probe: false,
    })

    expect(report.configuration.urlDefaulted).toBe(true)
    expect(format(report)).toContain('defaulted')
  })

  it('names a session written under more than one project directory', async () => {
    // Finding 74's moved-repository case, which ticket 69 asks to see.
    const config = await mkdtemp(join(tmpdir(), 'verify-'))
    await Promise.all(
      ['-home-taha-one', '-home-taha-two'].map(async (name) => {
        await mkdir(join(config, 'projects', name), { recursive: true })
        await writeFile(
          join(config, 'projects', name, 'session-1.jsonl'),
          entry(),
        )
      }),
    )

    const report = await collect({
      environment: { CLAUDE_CONFIG_DIR: config },
      platform: 'linux',
      hostname: 'laptop',
      probe: false,
    })

    expect(report.transcripts.movedBetweenProjects).toEqual([
      {
        sessionId: 'session-1',
        directories: ['-home-taha-one', '-home-taha-two'],
      },
    ])
    expect(format(report)).toContain('more than one project directory')
  })
})

describe('probeVerdict', () => {
  it('names a moved deployment as the URL to use, since a report cannot follow it', () => {
    expect(probeVerdict(301, 'https://sessclone.com/api/ingest')).toMatch(
      /redirects to https:\/\/sessclone\.com\/api\/ingest\*\*, which turns every report into a GET.*set the URL to https:\/\/sessclone\.com$/,
    )
  })

  it('never recommends a cleartext or elsewhere-routed redirect as the URL', () => {
    expect(probeVerdict(308, 'http://sessclone.com/api/ingest')).not.toMatch(
      /set the URL/,
    )
    expect(probeVerdict(307, 'https://sessclone.com/login')).toMatch(
      /does not survive — point the URL at the deployment itself, or fix the route/,
    )
    expect(probeVerdict(302)).toMatch(/\*\*redirects\*\*, which turns/)
  })

  it('keeps its words for the answers ingest gives', () => {
    expect(probeVerdict(400)).toBe('key accepted')
    expect(probeVerdict(404)).toMatch(/wrong URL/)
  })
})

const answer = (status, location) =>
  new Response(null, { status, headers: location ? { location } : {} })

describe('redirectTarget', () => {
  const asked = 'https://sessclone.vercel.app/api/ingest'

  it('resolves a relative or scheme-relative Location against the URL asked', () => {
    expect(redirectTarget(answer(308, '/v2/ingest'), asked)).toBe(
      'https://sessclone.vercel.app/v2/ingest',
    )
    expect(
      redirectTarget(answer(301, '//sessclone.com/api/ingest'), asked),
    ).toBe('https://sessclone.com/api/ingest')
  })

  it('drops a query, which could carry a token', () => {
    expect(
      redirectTarget(answer(302, 'https://sso.example/login?token=x'), asked),
    ).toBe('https://sso.example/login')
  })

  it('is null for anything but a redirect with a Location', () => {
    expect(redirectTarget(answer(400), asked)).toBeNull()
    expect(redirectTarget(answer(301), asked)).toBeNull()
  })
})
