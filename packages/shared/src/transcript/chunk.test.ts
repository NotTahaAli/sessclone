import { describe, expect, it } from 'vitest'

import { splitChunk } from './chunk.ts'

const enc = new TextEncoder()
const concat = (a: Uint8Array, b: Uint8Array) => {
  const out = new Uint8Array(a.length + b.length)
  out.set(a)
  out.set(b, a.length)
  return out
}

describe('splitChunk', () => {
  it('returns whole lines with byte offsets for a whole file', () => {
    const file = enc.encode('{"a":"é"}\n{"b":2}\n')
    const { lines, head, tail } = splitChunk(file, 0, {
      atFileStart: true,
      atFileEnd: true,
    })
    expect(lines).toEqual([
      { text: '{"a":"é"}', offset: 0 },
      // "é" is two bytes, so the second line starts at 11, not 10.
      { text: '{"b":2}', offset: 11 },
    ])
    expect(head.length).toBe(0)
    expect(tail.length).toBe(0)
  })

  it('keeps a trailing line without a newline only at file end', () => {
    const file = enc.encode('{"a":1}\n{"b":')
    expect(
      splitChunk(file, 0, { atFileStart: true, atFileEnd: false }).tail,
    ).toEqual(enc.encode('{"b":'))
    expect(
      splitChunk(file, 0, { atFileStart: true, atFileEnd: true }).lines,
    ).toHaveLength(2)
  })

  it('stitches backwards across a line boundary and a multibyte char', () => {
    const file = enc.encode('{"x":"one"}\n{"y":"€uro"}\n{"z":3}\n')
    // Cut inside the three-byte "€" (bytes 18..20).
    const cut = 19
    const last = splitChunk(file.slice(cut), cut, {
      atFileStart: false,
      atFileEnd: true,
    })
    expect(last.lines).toEqual([{ text: '{"z":3}', offset: 27 }])
    const first = splitChunk(concat(file.slice(0, cut), last.head), 0, {
      atFileStart: true,
      atFileEnd: false,
    })
    expect(first.lines).toEqual([
      { text: '{"x":"one"}', offset: 0 },
      { text: '{"y":"€uro"}', offset: 12 },
    ])
    expect(first.tail.length).toBe(0)
  })

  it('treats a chunk with no newline as all head', () => {
    const r = splitChunk(enc.encode('abc'), 10, {
      atFileStart: false,
      atFileEnd: false,
    })
    expect(r.lines).toEqual([])
    expect(r.head).toEqual(enc.encode('abc'))
    expect(r.tail.length).toBe(0)
  })
})
