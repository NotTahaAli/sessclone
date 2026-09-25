import { describe, expect, it, vi } from 'vitest'

import type { Item, Row } from '@sessclone/shared'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { sealed, writtenBefore } from './artifacts'
import { decode, parseEnvelope } from './envelope'
import { toolName } from './format'
import { currentReactions, emojiOf, parseStatus, readHearth } from './hearth'
import { IDLE_BATCH, MarkdownText, watch } from './markdown'
import { groupSteps, stepsLabel } from './steps'

const base = (offset: number, at: string | null = null) => ({
  id: `i${offset}`,
  offset,
  at,
  raw: null,
})
const use = (
  offset: number,
  name: string,
  input: unknown,
  at: string | null = null,
) =>
  ({
    ...base(offset, at),
    kind: 'tool_use',
    toolUseId: `t${offset}`,
    name,
    input,
    messageId: null,
    model: null,
    effort: null,
  }) as Extract<Item, { kind: 'tool_use' }>
const tool = (
  offset: number,
  name = 'Bash',
  at: string | null = null,
  endAt: string | null = null,
): Row => ({
  kind: 'tool',
  use: use(
    offset,
    name,
    name === 'Artifact' ? { file_path: '/a.html' } : {},
    at,
  ),
  result: endAt
    ? {
        ...base(offset + 1, endAt),
        kind: 'tool_result',
        toolUseId: `t${offset}`,
        isError: false,
        text: '',
        detail: null,
      }
    : null,
  durationMs: null,
  hooks: [],
})
const item = (
  offset: number,
  kind: 'user' | 'thinking' | 'assistant' | 'hook',
  at: string | null = null,
): Row => {
  const b = base(offset, at)
  const quiet = { messageId: null, model: null, effort: null }
  const one: Item =
    kind === 'hook'
      ? {
          ...b,
          kind,
          event: 'Stop',
          name: null,
          command: null,
          exitCode: 0,
          durationMs: null,
          failed: false,
          output: '',
          toolUseId: null,
        }
      : kind === 'thinking'
        ? { ...b, kind, text: '', ...quiet }
        : kind === 'assistant'
          ? {
              ...b,
              kind,
              text: '',
              ...quiet,
              requestId: null,
              usage: null,
              stopReason: null,
            }
          : { ...b, kind, text: '' }
  return { kind: 'item', item: one }
}

describe('groupSteps', () => {
  it('folds a run of steps between messages into one group', () => {
    const out = groupSteps([
      item(0, 'user'),
      item(1, 'thinking', '2026-01-01T00:00:00.000Z'),
      tool(2, 'Bash', '2026-01-01T00:00:01.000Z', '2026-01-01T00:00:09.000Z'),
      tool(4, 'Read', '2026-01-01T00:00:02.000Z', '2026-01-01T00:00:03.000Z'),
      item(6, 'assistant'),
    ])
    expect(out.map((row) => row.kind)).toEqual(['item', 'steps', 'item'])
    // Start of the first step to the end of whichever step finished last.
    expect(out[1]).toMatchObject({
      startAt: '2026-01-01T00:00:00.000Z',
      endAt: '2026-01-01T00:00:09.000Z',
    })
  })

  it('leaves a lone step as itself, and keeps artifacts and agents out', () => {
    const out = groupSteps([
      tool(0),
      item(2, 'assistant'),
      tool(3),
      tool(5, 'Artifact'),
      tool(7),
    ])
    expect(out.map((row) => row.kind)).toEqual([
      'tool',
      'item',
      'tool',
      'tool',
      'tool',
    ])
  })

  it('shows hearthbot replies, checklists and questions, folds the rest', () => {
    const out = groupSteps([
      tool(0),
      tool(2, 'mcp__hearthbot__reply'),
      tool(4, 'mcp__hearthbot__react'),
      tool(6, 'mcp__hearthbot__update_message'),
      tool(8, 'mcp__hearthbot__update_status'),
      tool(10, 'mcp__hearthbot__ask_decision'),
    ])
    expect(out.map((row) => row.kind)).toEqual([
      'tool',
      'tool',
      'steps',
      'tool',
      'tool',
    ])
  })
})

describe('toolName', () => {
  it('names an MCP tool by server and tool, and leaves the rest alone', () => {
    expect(toolName('mcp__hearthbot__update_status')).toBe(
      'hearthbot · update_status',
    )
    expect(toolName('Bash')).toBe('Bash')
    expect(toolName('mcp__solo')).toBe('mcp__solo')
  })
})

describe('stepsLabel', () => {
  it('says what the group holds', () => {
    expect(stepsLabel([item(0, 'thinking'), tool(1), tool(3)])).toBe(
      'Thought, 2 tools',
    )
    expect(stepsLabel([tool(1), item(3, 'hook')])).toBe('1 tool, 1 hook')
  })
})

const wake = `[image]
<wake reason="mention" current-time="2026-09-23T14:31:25Z">
  <project id="chan_1" type="project">
    <thread ts="cmsg_1">
      <message trigger="true" from="human" trust="principal" author="Taha" author-id="user_1" id="cmsg_2">I want it like claude&#39;s &lt;chat&gt;.</message>
    </thread>
  </project>
  <system-note>Act on it.</system-note>
</wake>

<untrusted-uploads nonce="n" untrusted="true">
The files listed here were attached.
    image.png (file_01S6a7hBegKex2brsoWoe7Sc) — being staged into this session
</untrusted-uploads nonce="n">`

describe('parseEnvelope', () => {
  it("keeps only the person's words, their name, and what they attached", () => {
    expect(parseEnvelope(wake)).toEqual({
      kind: 'wake',
      author: 'Taha',
      id: 'cmsg_2',
      body: "I want it like claude's <chat>.",
      files: ['image.png'],
      images: 1,
    })
  })

  it('recognises the session context block', () => {
    expect(parseEnvelope('<session-context nonce="x">…')).toEqual({
      kind: 'context',
    })
  })

  it('leaves anything else alone', () => {
    expect(parseEnvelope('plain text')).toBeNull()
    expect(parseEnvelope('<wake>no trigger message</wake>')).toBeNull()
  })

  it('decodes numeric and named entities, and leaves unknown ones', () => {
    expect(decode('&#34;a&#x27;&amp;&nope;')).toBe(`"a'&&nope;`)
  })
})

describe('writtenBefore', () => {
  const items: Item[] = [
    use(0, 'Write', { file_path: '/a.html', content: '<p>one</p>' }),
    use(10, 'Write', { file_path: '/b.html', content: 'other' }),
    use(20, 'Edit', { file_path: '/a.html' }),
    use(30, 'Write', { file_path: '/a.html', content: '<p>two</p>' }),
  ]

  it('is the last Write before the publish, marked stale after an Edit', () => {
    expect(writtenBefore(items, '/a.html', 25)).toEqual({
      status: 'found',
      html: '<p>one</p>',
      stale: true,
    })
    expect(writtenBefore(items, '/a.html', 40)).toEqual({
      status: 'found',
      html: '<p>two</p>',
      stale: false,
    })
  })

  it('is missing when this transcript never wrote the file', () => {
    expect(writtenBefore(items, '/c.html', 40)).toEqual({ status: 'missing' })
  })
})

describe('sealed', () => {
  it('puts the preview policy after the doctype, or first without one', () => {
    const page = sealed('<!DOCTYPE html><p>x</p>')
    expect(
      page.startsWith(
        '<!DOCTYPE html><meta http-equiv="Content-Security-Policy"',
      ),
    ).toBe(true)
    expect(page).toContain("default-src 'none'")
    expect(sealed('<p>x</p>').startsWith('<meta http-equiv')).toBe(true)
  })
})

// Counts how often rehype-highlight's attacher runs: each run registers every
// grammar it knows, so once per message made "Jump to start" seconds slower.
const highlighters = vi.hoisted(() => ({ built: 0 }))
vi.mock('rehype-highlight', async (importOriginal) => {
  const real = (await importOriginal<typeof import('rehype-highlight')>())
    .default
  return {
    default: (...args: Parameters<typeof real>) => {
      highlighters.built++
      return real(...args)
    },
  }
})

const html = (text: string) =>
  renderToStaticMarkup(createElement(MarkdownText, { text }))

describe('MarkdownText', () => {
  it('never loads an image: it becomes a link', () => {
    const out = html('![secret](https://evil.example/p?k=abc)')
    expect(out).not.toContain('<img')
    expect(out).toContain('href="https://evil.example/p?k=abc"')
  })

  it('shows raw HTML as text and drops javascript: links', () => {
    const out = html('<img src=x onerror=alert(1)> [go](javascript:alert(1))')
    expect(out).not.toContain('<img')
    expect(out).toContain('&lt;img')
    expect(out).not.toContain('javascript:')
  })

  it('labels a code block with its language and highlights it', () => {
    const out = html('```ts\nconst a = 1\n```')
    expect(out).toContain('>ts<')
    expect(out).toContain('hljs-keyword')
  })

  it('builds its highlighter once, not once per message', () => {
    const before = highlighters.built
    for (let n = 0; n < 3; n++) html('```ts\nconst a = 1\n```')
    expect(highlighters.built).toBe(before)
  })
})

describe('readHearth', () => {
  const result = (
    offset: number,
    toolUseId: string,
    text = '{"ok":true}',
    isError = false,
  ): Item => ({
    ...base(offset),
    kind: 'tool_result',
    toolUseId,
    isError,
    text,
    detail: null,
  })
  const hearth = readHearth([
    use(0, 'mcp__hearthbot__reply', { text: 'v1' }),
    result(1, 't0', '{"message_id":"cmsg_a","thread_id":"cmsg_t"}'),
    use(2, 'mcp__hearthbot__update_message', {
      message_id: 'cmsg_a',
      text: 'v2',
    }),
    result(3, 't2'),
    use(4, 'mcp__hearthbot__update_message', {
      message_id: 'cmsg_a',
      text: 'refused',
    }),
    result(5, 't4', 'message not found', true),
    use(6, 'mcp__hearthbot__react', { message_id: 'cmsg_a', emoji: '+1' }),
    result(7, 't6'),
    use(8, 'mcp__hearthbot__react', { message_id: 'cmsg_a', emoji: 'eyes' }),
    result(9, 't8'),
    use(10, 'mcp__hearthbot__unreact', { message_id: 'cmsg_a', emoji: '👀' }),
    result(11, 't10'),
    use(12, 'mcp__hearthbot__react', {
      message_id: 'cmsg_a',
      emoji: 'thumbsup',
    }),
    result(13, 't12'),
    use(14, 'mcp__hearthbot__react', { message_id: 'cmsg_a', emoji: 'tada' }),
    // No result: the call never landed, so nobody saw the emoji.
    use(16, 'mcp__hearthbot__reply', { text: 'lost' }),
    result(17, 't16', 'rate limited', true),
  ])

  it('ties a reply call to the message it made, and that message to its edits', () => {
    expect(hearth.replyIds.get('t0')).toBe('cmsg_a')
    expect(hearth.edits.get('cmsg_a')?.map((edit) => edit.text)).toEqual(['v2'])
  })

  it('ignores edits and reactions that failed or never answered', () => {
    expect(hearth.edits.get('cmsg_a')).toHaveLength(1)
    expect(hearth.reactions.get('cmsg_a')).toHaveLength(4)
    expect(hearth.replyIds.has('t16')).toBe(false)
  })

  it('shows only reactions not taken back, whichever way the emoji was written', () => {
    expect(currentReactions(hearth.reactions.get('cmsg_a'))).toEqual(['👍'])
    expect(emojiOf('+1')).toBe('👍')
    expect(emojiOf('🙂')).toBe('🙂')
    expect(emojiOf('nope_code')).toBe(':nope_code:')
    expect(emojiOf('constructor')).toBe(':constructor:')
  })
})

describe('parseStatus', () => {
  it('reads the header and each marked step', () => {
    expect(
      parseStatus('Task\n\n✓ Read it\n**✓ Built it**\n✱ Testing\n○ Ship'),
    ).toEqual({
      header: 'Task',
      lines: [
        { mark: 'done', text: 'Read it' },
        { mark: 'done', text: 'Built it' },
        { mark: 'doing', text: 'Testing' },
        { mark: 'todo', text: 'Ship' },
      ],
    })
  })

  it('drops bold wherever it sits', () => {
    expect(parseStatus('**Task**\n✓ **Built** it')).toEqual({
      header: 'Task',
      lines: [{ mark: 'done', text: 'Built it' }],
    })
  })
})

describe('deferred markdown', () => {
  it('turns every waiting message to markdown in idle batches, then stops', () => {
    const slices: (() => void)[] = []
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        unobserve() {}
      },
    )
    vi.stubGlobal('requestIdleCallback', (run: () => void) => slices.push(run))
    vi.stubGlobal('cancelIdleCallback', () => {})
    try {
      const shown: number[] = []
      const count = IDLE_BATCH + 5
      for (let n = 0; n < count; n++) {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- no DOM in these tests; the stub observer never reads it
        watch({} as Element, () => shown.push(n))
      }
      expect(slices).toHaveLength(1)
      slices.shift()?.()
      expect(shown).toHaveLength(IDLE_BATCH)
      slices.shift()?.()
      expect(shown).toEqual([...Array.from({ length: count }).keys()])
      expect(slices).toHaveLength(0)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
