// Ticket 103: cut an HTTP Range chunk of a JSONL file into whole lines.
//
// Works on bytes, not decoded text: a Range boundary can fall inside a
// multibyte UTF-8 character, and decoding first would turn both halves into
// U+FFFD. Splitting on 0x0A is safe because no UTF-8 continuation byte is
// ever 0x0A, so every line is decoded whole.
//
// The viewer loads a file from its END backwards. For each chunk it keeps
// `head` (the bytes up to and including the first newline: the end of a line
// that began in an earlier chunk) and, once it has fetched the earlier range
// [s2, start), calls splitChunk(concat(earlier, head), s2, ...). `tail` is the
// symmetric fragment after the last newline — a line still being written to
// a live file — and is only kept when the chunk does not reach the file end.

export type Line = { text: string; offset: number }

const NEWLINE = 0x0a
const decoder = new TextDecoder()

export function splitChunk(
  bytes: Uint8Array,
  /** Byte offset of bytes[0] within the file. */
  start: number,
  opts: { atFileStart: boolean; atFileEnd: boolean },
): { lines: Line[]; head: Uint8Array; tail: Uint8Array } {
  const empty = new Uint8Array(0)
  const first = bytes.indexOf(NEWLINE)
  if (first === -1 && !opts.atFileStart)
    return { lines: [], head: bytes, tail: empty }

  const from = opts.atFileStart ? 0 : first + 1
  const last = bytes.lastIndexOf(NEWLINE)
  const to = opts.atFileEnd ? bytes.length : last + 1
  const lines: Line[] = []
  let at = from
  while (at < to) {
    let end = bytes.indexOf(NEWLINE, at)
    if (end === -1 || end > to) end = to
    const text = decoder.decode(bytes.subarray(at, end)).replace(/\r$/, '')
    if (text.trim() !== '') lines.push({ text, offset: start + at })
    at = end + 1
  }
  return {
    lines,
    head: opts.atFileStart ? empty : bytes.slice(0, first + 1),
    tail: opts.atFileEnd ? empty : bytes.slice(Math.max(to, from)),
  }
}
