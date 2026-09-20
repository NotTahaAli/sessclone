import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'vitest'

import { parseTranscript } from './turns.ts'

// Ticket 29's acceptance criteria, made executable against the committed
// corpus. Every assertion is about the Turns a transcript yields, never about
// how the parser reaches them: this is the one place the counting can go
// wrong, and the shape of its loop is nobody's business.
const DIRECTORY = new URL('../fixtures/transcripts/', import.meta.url)

const fixture = (file: string) => readFileSync(new URL(file, DIRECTORY), 'utf8')

const turnsIn = (file: string) => parseTranscript(fixture(file))

const turn = (file: string, messageId: string) =>
  turnsIn(file).find((candidate) => candidate.messageId === messageId)

// Counted by hand off the corpus. The middle column is what a parser emitting
// one Turn per entry would bill; the right column is the truth. Where they
// differ is the overcount this ticket exists to prevent.
const EXPECTED = [
  { file: 'agent-run-ends-mid-turn.jsonl', usageEntries: 8, turns: 4 },
  { file: 'agent-run.jsonl', usageEntries: 1, turns: 1 },
  { file: 'compaction.jsonl', usageEntries: 2, turns: 1 },
  { file: 'fork-repeats-uuids.jsonl', usageEntries: 6, turns: 3 },
  { file: 'killed-mid-turn.jsonl', usageEntries: 0, turns: 0 },
  { file: 'model-switch.jsonl', usageEntries: 3, turns: 2 },
  { file: 'multi-iteration-turn.jsonl', usageEntries: 4, turns: 2 },
  {
    file: 'nested-run-inherits-parent-session-id.jsonl',
    usageEntries: 2,
    turns: 1,
  },
  { file: 'projects-thread-session.jsonl', usageEntries: 9, turns: 3 },
  { file: 'resume-appends-to-one-file.jsonl', usageEntries: 4, turns: 2 },
  { file: 'slash-model-is-not-a-switch.jsonl', usageEntries: 4, turns: 2 },
  { file: 'workflow-agent-run.jsonl', usageEntries: 1, turns: 1 },
]

// A transcript built from objects, for the cases the corpus cannot show:
// blocks of one group that disagree, and values no captured session produced.
const transcript = (...entries: unknown[]) =>
  entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n'

const assistant = (
  messageId: string,
  usage: Record<string, unknown>,
  rest: Record<string, unknown> = {},
) => ({
  type: 'assistant',
  sessionId: 's1',
  message: { id: messageId, model: 'claude-opus-5', ...rest, usage },
})

describe('one Turn per model response', () => {
  // The 2.4x overcount, guarded. Entries repeat per content block and share
  // one message.id, so a Turn per entry bills the same API call twice.
  test.each(EXPECTED)(
    '$file yields $turns Turns from $usageEntries usage entries',
    ({ file, turns }) => {
      expect(turnsIn(file)).toHaveLength(turns)
    },
  )

  test('keys on the presence of usage rather than a list of entry types', () => {
    // Seven of this file's twenty-seven entries are bookkeeping rows with no
    // uuid and no timestamp, and the types are open-ended: the parser must not
    // need their names to know they are not Turns.
    expect(turnsIn('nested-run-inherits-parent-session-id.jsonl')).toHaveLength(
      1,
    )
  })

  test('a session killed before its first response yields nothing to bill', () => {
    expect(turnsIn('killed-mid-turn.jsonl')).toEqual([])
  })

  test('three blocks to one response, which is the corpus at its worst', () => {
    // Every other fixture repeats a response twice. A Claude Projects session
    // writes three entries per response, so summing entries bills this file at
    // three times its real cost — and the table above would have gone on
    // passing if the parser only ever collapsed pairs.
    const turns = turnsIn('projects-thread-session.jsonl')

    expect(turns.map((parsed) => parsed.usage.outputTokens)).toEqual([
      386, 297, 566,
    ])
    expect(turns.every((parsed) => parsed.clientVersion === '2.1.278')).toBe(
      true,
    )
  })

  test('a compaction contributes no Turn of its own', () => {
    // Neither the compact_boundary nor the isCompactSummary entry carries a
    // usage block, so a compaction can only ever deflate a total — which is a
    // stated limit of the estimate, not something the parser can fix.
    expect(turnsIn('compaction.jsonl')).toHaveLength(1)
  })
})

describe('counters are the maximum across the group', () => {
  // The 200x undercount, guarded. apiBlockIndex 0 is the partial count written
  // while the response was still streaming: it reports 1 output token against
  // block 1's 202.
  test('takes the maximum, never the first block and never the sum', () => {
    expect(
      turn('agent-run-ends-mid-turn.jsonl', 'msg_011CeyFTpJKjmFVjAks1GSD8')
        ?.usage.outputTokens,
    ).toBe(202)
  })

  test('carries input, cache read, and cache creation as reported', () => {
    const usage = turn(
      'agent-run-ends-mid-turn.jsonl',
      'msg_011CeyFTpJKjmFVjAks1GSD8',
    )?.usage

    expect(usage?.inputTokens).toBe(2)
    expect(usage?.cacheReadInputTokens).toBe(35_869)
    expect(usage?.cacheCreationInputTokens).toBe(20_330)
  })

  test('ignores usage.iterations, which the top-level counters already state', () => {
    // Every captured session states one iteration that restates the top level,
    // so the corpus cannot tell reading it from ignoring it. Here they
    // disagree: the top-level block is authoritative, and summing the
    // iterations or reading the first would give 11 or 7.
    const turns = parseTranscript(
      transcript(
        assistant(
          'msg_iterations',
          {
            input_tokens: 1,
            output_tokens: 130,
            iterations: [
              { input_tokens: 7, output_tokens: 7 },
              { input_tokens: 4, output_tokens: 4 },
            ],
          },
          { stop_reason: 'end_turn' },
        ),
      ),
    )

    expect(turns[0]?.usage.outputTokens).toBe(130)
    expect(turns[0]?.usage.inputTokens).toBe(1)
  })
})

describe('cache creation stays split', () => {
  test('keeps the five-minute and one-hour classes apart', () => {
    const usage = turnsIn('multi-iteration-turn.jsonl')[0]?.usage

    expect(usage?.cacheCreation1hInputTokens).toBe(24_982)
    expect(usage?.cacheCreation5mInputTokens).toBe(0)
  })

  test('reads both classes from the entry that reported the total', () => {
    // Maximising the three counters independently composes a block no entry
    // ever reported: 20,330 five-minute tokens beside 24,982 one-hour tokens
    // against a reported total of 24,982, an 81% overbill of the most
    // expensive class.
    const turns = parseTranscript(
      transcript(
        assistant(
          'msg_cache',
          {
            output_tokens: 1,
            cache_creation_input_tokens: 20_330,
            cache_creation: {
              ephemeral_5m_input_tokens: 20_330,
              ephemeral_1h_input_tokens: 0,
            },
          },
          { stop_reason: null },
        ),
        assistant(
          'msg_cache',
          {
            output_tokens: 202,
            cache_creation_input_tokens: 24_982,
            cache_creation: {
              ephemeral_5m_input_tokens: 0,
              ephemeral_1h_input_tokens: 24_982,
            },
          },
          { stop_reason: 'end_turn' },
        ),
      ),
    )
    const usage = turns[0]?.usage

    expect(usage?.cacheCreationInputTokens).toBe(24_982)
    expect(usage?.cacheCreation5mInputTokens).toBe(0)
    expect(usage?.cacheCreation1hInputTokens).toBe(24_982)
  })

  test('the two classes account for the reported total across the corpus', () => {
    // If a future capture reports a cache-creation total with no split beside
    // it, this fails here rather than a Cost silently pricing the remainder at
    // nothing.
    for (const { file } of EXPECTED) {
      for (const parsed of turnsIn(file)) {
        expect(
          parsed.usage.cacheCreation5mInputTokens +
            parsed.usage.cacheCreation1hInputTokens,
        ).toBe(parsed.usage.cacheCreationInputTokens)
      }
    }
  })
})

describe('the modifiers that change or explain a price', () => {
  test('carries model, tier, speed, geography, and the client version', () => {
    const parsed = turnsIn('multi-iteration-turn.jsonl')[0]

    expect(parsed?.model).toBe('claude-haiku-4-5-20251001')
    expect(parsed?.serviceTier).toBe('standard')
    expect(parsed?.speed).toBe('standard')
    expect(parsed?.inferenceGeo).toBe('not_available')
    expect(parsed?.clientVersion).toBe('2.1.269')
  })

  test('reads a modifier that only the completed block wrote', () => {
    // Block 0 carries no `speed` at all and block 1 does, so taking the first
    // entry of the group would drop it.
    expect(
      turn('agent-run-ends-mid-turn.jsonl', 'msg_011CeyFTpJKjmFVjAks1GSD8')
        ?.speed,
    ).toBe('standard')
  })

  test('carries thinking tokens', () => {
    expect(turnsIn('multi-iteration-turn.jsonl')[0]?.usage.thinkingTokens).toBe(
      49,
    )
  })

  test('carries the server-tool counters, which no fixture exercises', () => {
    // Every captured session reports zero web searches and zero web fetches,
    // so the corpus would pass against a parser that hardcoded them.
    const turns = parseTranscript(
      transcript(
        assistant(
          'msg_server_tools',
          {
            output_tokens: 10,
            server_tool_use: { web_search_requests: 3, web_fetch_requests: 5 },
          },
          { stop_reason: 'end_turn' },
        ),
      ),
    )

    expect(turns[0]?.usage.webSearchRequests).toBe(3)
    expect(turns[0]?.usage.webFetchRequests).toBe(5)
  })

  test('a modifier comes from a block that finished, not the partial one', () => {
    // The counters already refuse to believe block 0. A modifier read from it
    // would price a Turn at a tier the completed response did not use — and
    // every block in the corpus agrees, so only a built case shows it.
    const turns = parseTranscript(
      transcript(
        assistant(
          'msg_tier',
          { output_tokens: 1, service_tier: 'standard' },
          { stop_reason: null },
        ),
        assistant(
          'msg_tier',
          { output_tokens: 202, service_tier: 'priority' },
          { stop_reason: 'end_turn' },
        ),
      ),
    )

    expect(turns[0]?.serviceTier).toBe('priority')
    expect(turns[0]?.usage.outputTokens).toBe(202)
  })

  test('a model switch inside one Session is two Turns with two models', () => {
    expect(turnsIn('model-switch.jsonl').map((parsed) => parsed.model)).toEqual(
      ['claude-haiku-4-5-20251001', 'claude-sonnet-5'],
    )
  })

  test('a slash command that switches nothing leaves the model alone', () => {
    expect(
      new Set(turnsIn('slash-model-is-not-a-switch.jsonl').map((p) => p.model)),
    ).toEqual(new Set(['claude-haiku-4-5-20251001']))
  })
})

describe('a Turn that never finished', () => {
  test('is marked incomplete rather than billed as a whole Turn', () => {
    // Every entry in the last group carries stop_reason: null. Its maximum is
    // a floor, not a total.
    const last = turnsIn('agent-run-ends-mid-turn.jsonl').at(-1)

    expect(last?.complete).toBe(false)
    expect(last?.usage.outputTokens).toBe(4)
  })

  test('a group with a stop reason anywhere in it is complete', () => {
    expect(
      turn('agent-run-ends-mid-turn.jsonl', 'msg_011CeyFTpJKjmFVjAks1GSD8')
        ?.complete,
    ).toBe(true)
  })
})

describe('identity', () => {
  test('a main Session has no agent id', () => {
    for (const parsed of turnsIn('multi-iteration-turn.jsonl')) {
      expect(parsed.agentId).toBeNull()
    }
  })

  test('an Agent Run carries its own agent id beside its parent Session id', () => {
    expect(turnsIn('agent-run.jsonl')).toMatchObject([
      {
        sessionId: '456e47f6-e387-59c4-b84c-21c031bb3504',
        agentId: 'a4a571530bd42856c',
      },
    ])
  })

  test('a workflow Agent Run is parsed the same way', () => {
    expect(turnsIn('workflow-agent-run.jsonl')).toMatchObject([
      {
        sessionId: '456e47f6-e387-59c4-b84c-21c031bb3504',
        agentId: 'a38fc2c136a5f46a3',
      },
    ])
  })

  test('the identity triple is unique within a transcript', () => {
    for (const { file } of EXPECTED) {
      const keys = turnsIn(file).map(
        (parsed) =>
          `${parsed.sessionId}|${parsed.agentId ?? ''}|${parsed.messageId}`,
      )

      expect(new Set(keys).size).toBe(keys.length)
    }
  })

  test('a fork repeats message ids under a new Session id', () => {
    // Accepted duplication, per the identity ADR: the key stays unique, so
    // nothing overcounts under it, and the repeated uuid is what makes the
    // duplication recoverable later rather than silently merged now.
    const original = turnsIn('resume-appends-to-one-file.jsonl')
    const forked = turnsIn('fork-repeats-uuids.jsonl')
    const originalIds = new Set(original.map((parsed) => parsed.messageId))
    const originalUuids = new Set(
      original.flatMap((parsed) => parsed.entryUuids),
    )
    const shared = forked.filter((parsed) => originalIds.has(parsed.messageId))

    expect(shared.length).toBeGreaterThan(0)
    for (const parsed of shared) {
      expect(parsed.entryUuids.some((uuid) => originalUuids.has(uuid))).toBe(
        true,
      )
      expect(
        original.some((source) => source.sessionId === parsed.sessionId),
      ).toBe(false)
    }
  })

  test('carries where the Turn ran, because the directory name cannot be reversed', () => {
    const parsed = turnsIn('multi-iteration-turn.jsonl')[0]

    expect(parsed?.cwd).toBe('/tmp/spike-07')
    expect(parsed?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})

describe('a transcript read while it is being written', () => {
  test('discards a torn last line and keeps everything before it', () => {
    // A kill landing inside a write leaves a half-written entry with no
    // trailing newline — finding 05 measured one at 78,686 bytes. A torn entry
    // is a prefix of a JSON object, so it is never itself parseable.
    const whole = fixture('multi-iteration-turn.jsonl')
    const torn = `${whole}{"type":"assistant","message":{"id":"msg_torn","usage":{"output_t`

    expect(parseTranscript(torn)).toEqual(parseTranscript(whole))
    expect(
      parseTranscript(torn).some((parsed) => parsed.messageId === 'msg_torn'),
    ).toBe(false)
  })

  test('keeps a complete last entry whose newline has not landed', () => {
    // The one deviation from finding 05's "truncate to the last newline":
    // that rule also drops a whole final entry, and on a transcript that never
    // grows again — a killed session — the Turn is lost for good.
    const whole = fixture('agent-run.jsonl')

    expect(parseTranscript(whole.trimEnd())).toEqual(parseTranscript(whole))
    expect(parseTranscript(whole.trimEnd())).toHaveLength(1)
  })

  test('a corrupt line mid-file costs that entry and nothing else', () => {
    const whole = fixture('multi-iteration-turn.jsonl')

    expect(parseTranscript(`{"type":"assistant"\n${whole}`)).toEqual(
      parseTranscript(whole),
    )
  })

  test('an empty transcript yields no Turns', () => {
    expect(parseTranscript('')).toEqual([])
  })
})

describe('the fixtures the assertions above skate past', () => {
  test('a workflow Agent Run that died on its first block', () => {
    // The corpus's only single-entry incomplete Turn, and its only Turn with a
    // modifier nothing ever stated.
    expect(turnsIn('workflow-agent-run.jsonl')).toMatchObject([
      {
        messageId: 'msg_011CeyDcYKQfCgFB7DTGKkfH',
        complete: false,
        speed: null,
        usage: { outputTokens: 1 },
      },
    ])
  })

  test('both partial groups in the same Agent Run, not just the first', () => {
    // A regression that special-cased one group would still pass on the other.
    expect(
      turn('agent-run-ends-mid-turn.jsonl', 'msg_011CeyFUCMNP4hMz6fBTZWxH')
        ?.usage.outputTokens,
    ).toBe(133)
  })

  test('a nested run is attributed to the Session id it reported', () => {
    // The gap ADR 0006 leaves open and hands to ticket 36: two conversations
    // present one session id, and the nested run's Turns land on the parent.
    // Pinned here so the known misgrouping is a recorded fact rather than a
    // surprise when ticket 36 changes it.
    expect(
      turnsIn('nested-run-inherits-parent-session-id.jsonl'),
    ).toMatchObject([
      {
        sessionId: '456e47f6-e387-59c4-b84c-21c031bb3504',
        agentId: null,
        usage: { outputTokens: 70 },
      },
    ])
  })

  test('a resumed Session keeps its id and adds fresh message ids', () => {
    const turns = turnsIn('resume-appends-to-one-file.jsonl')

    expect(new Set(turns.map((parsed) => parsed.sessionId)).size).toBe(1)
    expect(new Set(turns.map((parsed) => parsed.messageId)).size).toBe(
      turns.length,
    )
  })
})

describe('input a transcript should not contain', () => {
  test('an entry with no usable message id is not a Turn', () => {
    // Grouped on a null id, two API calls become one Turn and the smaller is
    // discarded — and a null heads a column the unique index is built on.
    const turns = parseTranscript(
      transcript(
        {
          type: 'assistant',
          sessionId: 's1',
          message: { id: null, usage: { output_tokens: 5 } },
        },
        {
          type: 'assistant',
          sessionId: 's1',
          message: { id: null, usage: { output_tokens: 9 } },
        },
      ),
    )

    expect(turns).toEqual([])
  })

  test('a counter that is not a count is read as absent', () => {
    // `1e999` is a number JSON accepts and JavaScript cannot hold: it parses
    // to Infinity, which serialises straight back to null in a payload, so a
    // Cost computed from it prices nothing at all. NaN does the same.
    const turns = parseTranscript(
      '{"type":"assistant","sessionId":"s1","message":{"id":"msg_hostile",' +
        '"stop_reason":"end_turn","usage":{"output_tokens":"many",' +
        '"input_tokens":-5,"cache_read_input_tokens":1e999,' +
        '"cache_creation_input_tokens":2.5}}}\n',
    )

    expect(turns[0]?.usage).toMatchObject({
      outputTokens: 0,
      inputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    })
  })

  test('an empty agent id is absence, not an Agent Run', () => {
    const turns = parseTranscript(
      transcript(
        assistant(
          'msg_agentless',
          { output_tokens: 1 },
          { stop_reason: 'end_turn' },
        ),
      ).replace('"type":"assistant"', '"type":"assistant","agentId":""'),
    )

    expect(turns[0]?.agentId).toBeNull()
  })
})
