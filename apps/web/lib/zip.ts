import { crc32 } from 'node:zlib'

// Ticket 140: a zip written as it is read, so a download of every transcript
// never holds one of them, let alone all of them.
//
// Stored (method 0), not deflated, and each entry's CRC and size follow its
// bytes in a data descriptor (flag bit 3), which is what lets an entry be
// written before its length is known. Names are UTF-8 (flag bit 11).
// ponytail: stored, not deflated — JSONL would shrink several times over;
// pipe each entry through `zlib.createDeflateRaw` (method 8) if size matters.
// ponytail: no ZIP64, so the archive ends before 4 GiB and 65,535 entries;
// the writer throws past either, and the route caps well under both.

export type ZipEntry = {
  /** The path inside the archive, `/`-separated. */
  name: string
  modified: Date
  body: AsyncIterable<Uint8Array>
}

const LIMIT = 0xffff_ffff
const FLAGS = 0x0808 // data descriptor + UTF-8 names
const VERSION = 20 // 2.0: what a stored entry with a descriptor needs

/** DOS time and date, which is all a zip header holds. Read as UTC. */
const dos = (at: Date) => ({
  time:
    (at.getUTCHours() << 11) |
    (at.getUTCMinutes() << 5) |
    Math.floor(at.getUTCSeconds() / 2),
  date:
    (Math.max(0, at.getUTCFullYear() - 1980) << 9) |
    ((at.getUTCMonth() + 1) << 5) |
    at.getUTCDate(),
})

const header = (size: number) => {
  const bytes = new Uint8Array(size)
  return { bytes, view: new DataView(bytes.buffer) }
}

/** The archive's bytes, entry by entry, then the central directory. */
export async function* zip(
  entries: AsyncIterable<ZipEntry> | Iterable<ZipEntry>,
): AsyncGenerator<Uint8Array> {
  const written: {
    name: Uint8Array
    time: number
    date: number
    crc: number
    size: number
    offset: number
  }[] = []
  let offset = 0

  for await (const entry of entries) {
    const name = new TextEncoder().encode(entry.name)
    const { time, date } = dos(entry.modified)

    const local = header(30 + name.length)
    local.view.setUint32(0, 0x04034b50, true)
    local.view.setUint16(4, VERSION, true)
    local.view.setUint16(6, FLAGS, true)
    local.view.setUint16(10, time, true)
    local.view.setUint16(12, date, true)
    // CRC and sizes (14..25) stay zero: the descriptor carries them.
    local.view.setUint16(26, name.length, true)
    local.bytes.set(name, 30)
    yield local.bytes

    let crc = 0
    let size = 0
    for await (const piece of entry.body) {
      crc = crc32(piece, crc)
      size += piece.byteLength
      yield piece
    }

    const descriptor = header(16)
    descriptor.view.setUint32(0, 0x08074b50, true)
    descriptor.view.setUint32(4, crc, true)
    descriptor.view.setUint32(8, size, true)
    descriptor.view.setUint32(12, size, true)
    yield descriptor.bytes

    written.push({ name, time, date, crc, size, offset })
    offset += local.bytes.length + size + descriptor.bytes.length
    if (offset > LIMIT || written.length > 0xffff) {
      throw new Error('the archive outgrew a zip without ZIP64')
    }
  }

  let directory = 0
  for (const entry of written) {
    const central = header(46 + entry.name.length)
    central.view.setUint32(0, 0x02014b50, true)
    central.view.setUint16(4, VERSION, true)
    central.view.setUint16(6, VERSION, true)
    central.view.setUint16(8, FLAGS, true)
    central.view.setUint16(12, entry.time, true)
    central.view.setUint16(14, entry.date, true)
    central.view.setUint32(16, entry.crc, true)
    central.view.setUint32(20, entry.size, true)
    central.view.setUint32(24, entry.size, true)
    central.view.setUint16(28, entry.name.length, true)
    central.view.setUint32(42, entry.offset, true)
    central.bytes.set(entry.name, 46)
    directory += central.bytes.length
    yield central.bytes
  }

  if (offset + directory > LIMIT) {
    throw new Error('the archive outgrew a zip without ZIP64')
  }
  const end = header(22)
  end.view.setUint32(0, 0x06054b50, true)
  end.view.setUint16(8, written.length, true)
  end.view.setUint16(10, written.length, true)
  end.view.setUint32(12, directory, true)
  end.view.setUint32(16, offset, true)
  yield end.bytes
}

/**
 * A byte generator as the body of a Response, pulled only as fast as the
 * client reads — and returned, so its `finally` blocks run, when the client
 * goes away.
 */
export const streamOf = (bytes: AsyncGenerator<Uint8Array>) =>
  new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await bytes.next()
      if (next.done) controller.close()
      else controller.enqueue(next.value)
    },
    async cancel() {
      await bytes.return(undefined)
    },
  })
