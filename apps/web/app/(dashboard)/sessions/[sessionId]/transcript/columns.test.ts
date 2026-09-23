import { describe, expect, it } from 'vitest'

import {
  agentColumn,
  columnWidths,
  earlierRange,
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

describe('earlierRange', () => {
  it('reads the last chunk first, then backwards to byte 0', () => {
    expect(earlierRange(2500, 1000)).toEqual({ start: 1500, end: 2499 })
    expect(earlierRange(700, 1000)).toEqual({ start: 0, end: 699 })
    expect(earlierRange(0, 1000)).toBeNull()
  })
})
