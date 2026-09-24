import { describe, expect, it } from 'vitest'

import { fixtureText, loadFixture } from './fixtures.test-helper.ts'
import { parseJournal, parseLines, parseMeta } from './parse.ts'
import type { Item, ItemKind } from './types.ts'

const items = loadFixture('main-session.jsonl')
const of = <K extends ItemKind>(kind: K) =>
  items.filter((i): i is Extract<Item, { kind: K }> => i.kind === kind)

describe('parseLines', () => {
  it('turns every line into at least one Item and never throws', () => {
    expect(items.map((i) => i.kind)).toEqual([
      'queue',
      'hook',
      'user',
      'attachment',
      'thinking',
      'tool_use',
      'hook',
      'tool_result',
      'hook',
      'tool_use',
      'tool_result',
      'injected',
      'tool_use',
      'tool_result',
      'tool_use',
      'tool_result',
      'hook',
      'thinking',
      'assistant',
      'interrupt',
      'slash_command',
      'compaction',
      'injected',
      'api_error',
      'unknown',
      'unknown',
    ])
  })

  it('keeps an empty thinking block as an empty thinking Item', () => {
    expect(of('thinking')[0]).toMatchObject({
      text: '',
      messageId: 'msg_1',
      model: 'claude-opus-x',
      effort: 'medium',
    })
  })

  it('reads assistant text with its message identity and usage', () => {
    expect(of('assistant')[0]).toMatchObject({
      text: 'Done.',
      messageId: 'msg_5',
      requestId: 'req_msg_5',
      stopReason: 'end_turn',
      usage: {
        inputTokens: 3,
        outputTokens: 202,
        cacheReadInputTokens: 400,
        cacheCreationInputTokens: 0,
      },
    })
  })

  it('reads tool results with their toolUseResult detail', () => {
    expect(of('tool_result')[0]).toMatchObject({
      toolUseId: 'toolu_bash',
      isError: false,
      text: 'a.txt',
    })
    expect(of('tool_result')[2]).toMatchObject({
      text: 'Async agent launched successfully.\nagentId: a111',
      detail: { agentId: 'a111' },
    })
  })

  it('reads hooks, marking errors as failed', () => {
    const [start, pre, post, prompt] = of('hook')
    expect(start).toMatchObject({
      event: 'SessionStart',
      command: 'start.sh',
      exitCode: 0,
      durationMs: 12,
      failed: false,
      output: 'ok',
    })
    expect(pre).toMatchObject({ event: 'PreToolUse', toolUseId: 'toolu_bash' })
    expect(post).toMatchObject({
      event: 'PostToolUse',
      failed: true,
      exitCode: 1,
      output: 'lint failed',
    })
    expect(prompt).toMatchObject({
      event: 'UserPromptSubmit',
      failed: false,
      output: 'Remember the rules',
    })
  })

  it('recognises interrupt, slash command, compaction and api error', () => {
    expect(of('interrupt')[0]?.text).toBe('[Request interrupted by user]')
    expect(of('slash_command')[0]).toMatchObject({
      name: '/model',
      args: 'opus',
    })
    expect(of('compaction')[0]).toMatchObject({
      trigger: 'manual',
      preTokens: 5000,
    })
    expect(of('injected')[1]?.text).toContain('Summary')
    expect(of('api_error')[0]?.text).toBe('API Error: 529 Overloaded')
  })

  it('keeps unknown and malformed lines as unknown Items', () => {
    const [title, broken] = of('unknown')
    expect(title?.type).toBe('ai-title')
    expect(broken?.type).toBeNull()
    expect(broken?.raw).toBe('{"type":"user","message":')
  })

  it('suffixes ids when one line yields several Items', () => {
    expect(
      parseLines([
        {
          offset: 0,
          text: '{"type":"user","uuid":"u","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"a"},{"type":"tool_result","tool_use_id":"t2","content":"b","is_error":true}]}}',
        },
      ]),
    ).toMatchObject([
      { id: 'u:0', toolUseId: 't1' },
      { id: 'u:1', toolUseId: 't2', isError: true },
    ])
  })

  it('reads a hostile prompt in linear time', () => {
    // An unclosed tag repeated across a prompt once cost a scan to the end
    // from every one of them.
    const text = '<command-name>'.repeat(20_000)
    const started = performance.now()
    const [item] = parseLines([
      {
        offset: 0,
        text: JSON.stringify({ type: 'user', message: { content: text } }),
      },
    ])
    expect(performance.now() - started).toBeLessThan(200)
    expect(item?.kind).toBe('user')
  })
})

describe('parseJournal', () => {
  it('lists started agents and marks those with a result as done', () => {
    expect(parseJournal(fixtureText('journal.jsonl'))).toEqual([
      { agentId: 'a1', label: 'probe-a', phase: 'Probe', done: true },
      { agentId: 'a2', label: 'probe-b', phase: 'Probe', done: false },
    ])
  })

  it('ignores garbage lines', () => {
    expect(parseJournal('nope\n{"type":"result"}\n')).toEqual([])
  })
})

describe('parseMeta', () => {
  it('reads a Task agent sidecar', () => {
    expect(parseMeta(fixtureText('agent.meta.json'))).toEqual({
      agentType: 'Explore',
      description: 'Explore repo',
      toolUseId: 'toolu_agent',
      spawnDepth: 1,
      workflowPhase: null,
      model: 'sonnet',
    })
  })

  it('reads a workflow agent sidecar', () => {
    expect(parseMeta(fixtureText('workflow-agent.meta.json'))).toMatchObject({
      agentType: 'workflow-subagent',
      workflowPhase: 'Probe',
      toolUseId: null,
      model: null,
    })
  })

  it('returns all nulls for garbage', () => {
    expect(parseMeta('not json').agentType).toBeNull()
  })
})

// A background agent's own file often ends with stop_reason null even when
// it finished; the parent learns it finished from a task-notification.
const note = (id: string, status: string) =>
  `<task-notification>\n<task-id>${id}</task-id>\n<status>${status}</status>\n<summary>Agent finished</summary>\n</task-notification>`

describe('a task-notification delivered as a user line', () => {
  it('is injected text, not something the person typed', () => {
    const [item] = parseLines([
      {
        offset: 0,
        text: JSON.stringify({
          type: 'user',
          uuid: 'u-note',
          timestamp: '2026-01-01T00:00:00.000Z',
          message: { role: 'user', content: note('a111', 'completed') },
        }),
      },
    ])
    expect(item?.kind).toBe('injected')
  })
})
