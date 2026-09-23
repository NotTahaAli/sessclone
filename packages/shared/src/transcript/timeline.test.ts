import { describe, expect, it } from 'vitest'

import { loadFixture } from './fixtures.test-helper.ts'
import {
  buildTimeline,
  categoryOf,
  summarizeRun,
  visibleRows,
} from './timeline.ts'
import { ALL, NORMAL, type Row } from './types.ts'

const items = loadFixture('main-session.jsonl')
const rows = buildTimeline(items)
const find = <K extends Row['kind']>(kind: K) =>
  rows.filter((r): r is Extract<Row, { kind: K }> => r.kind === kind)

describe('buildTimeline', () => {
  it('pairs a tool call with its result, duration and hooks', () => {
    const [bash] = find('tool')
    expect(bash?.use.name).toBe('Bash')
    expect(bash?.result?.text).toBe('a.txt')
    expect(bash?.durationMs).toBe(1500)
    expect(bash?.hooks.map((h) => h.event)).toEqual([
      'PreToolUse',
      'PostToolUse',
    ])
  })

  it('keeps unrelated hooks as standalone rows', () => {
    const hooks = rows.flatMap((r) =>
      r.kind === 'item' && r.item.kind === 'hook' ? [r.item.event] : [],
    )
    expect(hooks).toEqual(['SessionStart', 'UserPromptSubmit'])
  })

  it('pairs a result that was loaded before its call', () => {
    const use = items.findIndex((i) => i.kind === 'tool_use')
    const result = items.findIndex((i) => i.kind === 'tool_result')
    const resultOnly = buildTimeline([items[result]!])
    expect(resultOnly).toEqual([{ kind: 'item', item: items[result] }])
    // A later chunk arrives first; the call's chunk after it.
    const both = buildTimeline([items[result]!, items[use]!])
    expect(both.filter((r) => r.kind === 'tool')).toHaveLength(1)
    expect(both.some((r) => r.kind === 'item')).toBe(false)
  })

  it('leaves a call with no loaded result open', () => {
    const use = items.find((i) => i.kind === 'tool_use')!
    const [, tool] = buildTimeline([use])
    expect(tool).toMatchObject({ kind: 'tool', result: null, durationMs: null })
  })

  it('makes a skill row carrying the injected skill text', () => {
    const [skill] = find('skill')
    expect(skill?.skill).toBe('tdd')
    expect(skill?.result?.text).toBe('Launching skill: tdd')
    expect(skill?.content?.text).toBe('Skill body here')
    expect(
      rows.some((r) => r.kind === 'item' && r.item.id === skill?.content?.id),
    ).toBe(false)
  })

  it('makes an agent row from the call and its result', () => {
    expect(find('agent')[0]).toMatchObject({
      agentId: 'a111',
      agentType: 'Explore',
      description: 'Explore repo',
      prompt: 'Find files',
      model: 'claude-sonnet-x',
    })
  })

  it('makes a workflow row with its runId', () => {
    expect(find('workflow')[0]).toMatchObject({
      runId: 'wf_abc',
      name: 'probe',
      summary: 'Tiny probe',
    })
  })

  it('draws a section at the top and on each model or effort change', () => {
    expect(rows[0]).toEqual({
      kind: 'section',
      model: 'claude-opus-x',
      effort: 'medium',
    })
    expect(find('section')).toEqual([
      { kind: 'section', model: 'claude-opus-x', effort: 'medium' },
      { kind: 'section', model: 'claude-sonnet-x', effort: 'medium' },
      { kind: 'section', model: 'claude-sonnet-x', effort: 'high' },
    ])
  })

  it('takes usage as the max per counter across a message', () => {
    const text = rows.find(
      (r) => r.kind === 'item' && r.item.kind === 'assistant',
    )
    expect(
      text?.kind === 'item' &&
        text.item.kind === 'assistant' &&
        text.item.usage,
    ).toEqual({
      inputTokens: 3,
      outputTokens: 202,
      cacheReadInputTokens: 500,
      cacheCreationInputTokens: 0,
    })
  })

  it('keeps the other kinds as item rows', () => {
    const kinds = rows.flatMap((r) => (r.kind === 'item' ? [r.item.kind] : []))
    expect(kinds).toEqual(
      expect.arrayContaining([
        'queue',
        'user',
        'attachment',
        'thinking',
        'interrupt',
        'slash_command',
        'compaction',
        'injected',
        'api_error',
        'unknown',
      ]),
    )
  })
})

describe('summarizeRun', () => {
  it('is done when the last message ended its turn', () => {
    expect(summarizeRun(loadFixture('agent-done.jsonl'))).toEqual({
      status: 'done',
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: '2026-01-01T00:00:01.000Z',
      durationMs: 1000,
      toolCount: 0,
      model: 'claude-opus-x',
      effort: 'medium',
    })
  })

  it('is running while a tool call has no result', () => {
    const run = summarizeRun(loadFixture('agent-running.jsonl'))
    expect(run).toMatchObject({ status: 'running', toolCount: 1 })
  })

  it('is running while the model has not answered a tool result', () => {
    expect(summarizeRun(loadFixture('agent-awaiting-model.jsonl')).status).toBe(
      'running',
    )
  })

  it('is done when a finished run ends in text with no stop reason', () => {
    // Real subagents, background ones especially, end like this (2026-09-23).
    expect(summarizeRun(loadFixture('agent-done-no-stop.jsonl')).status).toBe(
      'done',
    )
  })

  it('died mid turn when the last message never got a stop reason', () => {
    const died = loadFixture('agent-died.jsonl')
    expect(summarizeRun(died).status).toBe('died_mid_turn')
    expect(summarizeRun(died, { returned: true }).status).toBe('done')
  })

  it('is not_stored with nothing loaded', () => {
    expect(summarizeRun([]).status).toBe('not_stored')
  })
})

describe('visibleRows', () => {
  it('NORMAL hides hooks, attachments, queue, unknown and tool output', () => {
    const { rows: shown, showToolOutput } = visibleRows(rows, NORMAL)
    expect(showToolOutput).toBe(false)
    const cats = new Set<string>(shown.map(categoryOf))
    for (const hidden of ['hook', 'attachment', 'queue', 'unknown', 'injected'])
      expect(cats.has(hidden)).toBe(false)
    // Collapsed thinking stays; the renderer collapses it.
    expect(cats.has('thinking')).toBe(true)
    expect(cats.has('tool')).toBe(true)
  })

  it('shows a failed hook as hook_failed', () => {
    const failed = { ...items.find((i) => i.kind === 'hook')!, failed: true }
    const row: Row = { kind: 'item', item: failed }
    expect(categoryOf(row)).toBe('hook_failed')
    expect(visibleRows([row], NORMAL).rows).toEqual([row])
  })

  it('ALL shows every row and tool output', () => {
    const { rows: shown, showToolOutput } = visibleRows(rows, ALL)
    expect(shown).toEqual(rows)
    expect(showToolOutput).toBe(true)
  })

  it('hidden thinking removes thinking rows', () => {
    const { rows: shown } = visibleRows(rows, { ...ALL, thinking: 'hidden' })
    expect(shown.map(categoryOf)).not.toContain('thinking')
    expect(shown).toHaveLength(rows.length - 2)
  })
})
