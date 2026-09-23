import { describe, expect, it } from 'vitest'

import { duration, field, offset, sectionLabel, toolSummary } from './format'

describe('duration', () => {
  it('says it in the fewest characters that stay readable', () => {
    expect(duration(850)).toBe('850ms')
    expect(duration(12_345)).toBe('12.3s')
    expect(duration(245_000)).toBe('4m 05s')
    expect(duration(3_720_000)).toBe('1h 02m')
  })
})

describe('offset', () => {
  it('is the time since the session started, or nothing', () => {
    expect(offset('2026-09-23T10:04:05Z', '2026-09-23T10:00:00Z')).toBe(
      '+4m 05s',
    )
    expect(offset(null, '2026-09-23T10:00:00Z')).toBeNull()
    expect(offset('nonsense', '2026-09-23T10:00:00Z')).toBeNull()
  })
})

describe('toolSummary', () => {
  it('prefers what each tool is about', () => {
    expect(
      toolSummary('Bash', { command: 'ls -la', description: 'List files' }),
    ).toBe('List files')
    expect(toolSummary('Bash', { command: 'ls   -la\n' })).toBe('ls -la')
    expect(toolSummary('Edit', { file_path: '/a/b.ts', old_string: 'x' })).toBe(
      '/a/b.ts',
    )
    expect(toolSummary('Grep', { pattern: 'foo.*', path: '/src' })).toBe(
      'foo.*',
    )
  })

  it('falls back to the first string input, and to nothing', () => {
    expect(toolSummary('WebFetch', { url: 'https://x.dev', n: 3 })).toBe(
      'https://x.dev',
    )
    expect(toolSummary('Mystery', { n: 3 })).toBe('')
    expect(toolSummary('Mystery', null)).toBe('')
  })

  it('clips a long line', () => {
    expect(toolSummary('Bash', { command: 'x'.repeat(500) })).toHaveLength(120)
  })
})

describe('field', () => {
  it('walks a path it was never promised', () => {
    const raw = { message: { usage: { output_tokens_details: { n: 136 } } } }
    expect(field(raw, 'message', 'usage', 'output_tokens_details', 'n')).toBe(
      136,
    )
    expect(field(raw, 'message', 'nope', 'n')).toBeUndefined()
    expect(field('text', 'length')).toBeUndefined()
  })
})

describe('sectionLabel', () => {
  it('names the model and the effort', () => {
    expect(sectionLabel('claude-opus-5-5', 'high')).toBe(
      'claude-opus-5-5 · high',
    )
    expect(sectionLabel(null, null)).toBe('model not reported')
  })
})
