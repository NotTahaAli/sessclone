import { describe, expect, it } from 'vitest'

import {
  agentColumn,
  columnWidths,
  earlierRead,
  keepReading,
  splitEarlier,
  readWidths,
  toggleColumn,
  workflowColumn,
  type Column,
} from './columns'

const main: Column = { kind: 'main', key: 'main' }
const a = agentColumn('a1', 'Explore')
const b = agentColumn('b2', 'Review')
const w = workflowColumn('wf_1', 'probe')

describe('toggleColumn', () => {
  it('opens to the right of the column the block is in', () => {
    expect(toggleColumn([main], 0, a)).toEqual([main, a])
  })

  it('closes anything deeper when opening from an earlier column', () => {
    expect(toggleColumn([main, a, b], 0, w)).toEqual([main, w])
  })

  it('closes the column (and deeper) when its own block is tapped again', () => {
    expect(toggleColumn([main, w, a], 0, w)).toEqual([main])
    expect(toggleColumn([main, w, a], 1, a)).toEqual([main, w])
  })
})

describe('columnWidths', () => {
  it('fills the row with one column', () => {
    expect(columnWidths(1, 1200, { main: 900 })).toEqual([null])
  })

  it('gives side columns 440px and the main column the rest', () => {
    expect(columnWidths(2, 1200, {})).toEqual([760, 440])
  })

  it('never lets the main column fall under 440px', () => {
    expect(columnWidths(3, 1000, {})).toEqual([440, 440, 440])
  })

  it('uses dragged widths, clamped to the minimum', () => {
    expect(columnWidths(2, 1200, { main: 600, side: 300 })).toEqual([600, 440])
  })
})

describe('readWidths', () => {
  it('keeps only sane numbers', () => {
    expect(readWidths('{"main":612.4,"side":"wide"}')).toEqual({ main: 612 })
    expect(readWidths('{"side":100}')).toEqual({})
  })

  it('survives garbage and nothing', () => {
    expect(readWidths('not json')).toEqual({})
    expect(readWidths(null)).toEqual({})
    expect(readWidths('[1]')).toEqual({})
  })
})

const walk = (file: Parameters<typeof earlierRead>[0], from: number) => {
  const reads = []
  for (let read = earlierRead(file, from, 1000); read;) {
    reads.push(read)
    read = earlierRead(file, read.start, 1000)
  }
  return reads
}

describe('earlierRead', () => {
  const whole = { tailOffset: 0, chunks: [] }

  it('with zero chunks reads the ranges it always did', () => {
    // What earlierRange and rangesToStart answered before ADR 0008.
    expect(walk(whole, 2500)).toEqual([
      { kind: 'range', start: 1500, end: 2499 },
      { kind: 'range', start: 500, end: 1499 },
      { kind: 'range', start: 0, end: 499 },
    ])
    expect(earlierRead(whole, 0, 1000)).toBeNull()
  })

  const chunked = {
    tailOffset: 3000,
    chunks: [
      { rawOffset: 0, rawLength: 1200 },
      { rawOffset: 1200, rawLength: 1800 },
    ],
  }

  it('clamps a tail shorter than one read at the tail', () => {
    expect(earlierRead(chunked, 3400, 1000)).toEqual({
      kind: 'range',
      start: 3000,
      end: 3399,
    })
  })

  it('crosses from the tail into the last chunk, read whole', () => {
    expect(earlierRead(chunked, 3000, 1000)).toEqual({
      kind: 'chunk',
      index: 1,
      start: 1200,
      end: 2999,
    })
  })

  it('walks to byte 0 with no gap and no repeat', () => {
    const reads = walk(chunked, 5500)
    expect(reads).toEqual([
      { kind: 'range', start: 4500, end: 5499 },
      { kind: 'range', start: 3500, end: 4499 },
      { kind: 'range', start: 3000, end: 3499 },
      { kind: 'chunk', index: 1, start: 1200, end: 2999 },
      { kind: 'chunk', index: 0, start: 0, end: 1199 },
    ])
    reads.forEach((read, i) => {
      expect(read.end + 1).toBe(i === 0 ? 5500 : reads[i - 1]!.start)
    })
  })

  it('reads a chunk only up to where the loaded bytes begin', () => {
    expect(earlierRead(chunked, 2000, 1000)).toEqual({
      kind: 'chunk',
      index: 1,
      start: 1200,
      end: 1999,
    })
  })
})

describe('keepReading', () => {
  const view = { scrollHeight: 5000, clientHeight: 800 }
  it('keeps reading while nothing has parsed, even when the view looks full', () => {
    // A last line over a chunk long: no whole line yet, nothing to scroll.
    expect(keepReading({ from: 3_000_000, items: 0, ...view })).toBe(true)
  })
  it('keeps reading while the rows do not overflow the view', () => {
    expect(
      keepReading({ from: 10, items: 3, scrollHeight: 900, clientHeight: 800 }),
    ).toBe(true)
  })
  it('stops once the rows overflow, or at the start of the file', () => {
    expect(keepReading({ from: 10, items: 3, ...view })).toBe(false)
    expect(keepReading({ from: 0, items: 0, ...view })).toBe(false)
  })
})

const bytes = (text: string) => new TextEncoder().encode(text)

describe('splitEarlier', () => {
  it('drops a last line still being written instead of emitting it broken', () => {
    expect(splitEarlier(bytes('{"a":1}\n{"b":'), 0).lines).toEqual([
      { text: '{"a":1}', offset: 0 },
    ])
    const end = splitEarlier(bytes('x"}\n{"a":1}\n{"b":'), 100)
    expect(end.lines).toEqual([{ text: '{"a":1}', offset: 104 }])
    expect(end.head).toEqual(bytes('x"}\n'))
  })
  it('keeps every line of a chunk that ends in a newline', () => {
    expect(splitEarlier(bytes('{"a":1}\n{"b":2}\n'), 0).lines).toHaveLength(2)
  })
})
