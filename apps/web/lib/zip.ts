import { crc32 } from 'node:zlib'

// Ticket 140: a zip written as it is read, so a download of every transcript
// never holds one of them, let alone all of them.
//
// Each entry is deflated (method 8) as it streams, and its CRC and sizes
// follow its bytes in a data descriptor (flag bit 3), which is what lets an
// entry be written before its length is known. A deflated entry with a
// descriptor is one every reader handles, Java's streaming `ZipInputStream`
// included; a stored one is not. Names are UTF-8 (flag bit 11).
//
// ZIP64 where the archive needs it: past 4 GiB of offsets or 65,535 entries
// the central directory carries 64-bit offsets and a ZIP64 end record. One
// entry still holds under 4 GiB either way, which a transcript does by far;
// the writer throws rather than write one that does not.

export type ZipEntry = {
  /** The path inside the archive, `/`-separated. */
  name: string
  modified: Date
  body: AsyncIterable<Uint8Array>
}

const LIMIT = 0xffff_ffff
const FLAGS = 0x0808 // data descriptor + UTF-8 names
const DEFLATE = 8
const VERSION = 20 // 2.0: deflate with a descriptor
const VERSION_ZIP64 = 45 // 4.5: ZIP64 fields

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

/** The body, deflated, with its CRC and raw size counted on the way in. */
async function* deflated(
  body: AsyncIterable<Uint8Array>,
  count: { crc: number; size: number },
) {
  const raw = ReadableStream.from(
    (async function* () {
      for await (const piece of body) {
        count.crc = crc32(piece, count.crc)
        count.size += piece.byteLength
        yield piece
      }
    })(),
  )
  yield* raw.pipeThrough(new CompressionStream('deflate-raw'))
}

/**
 * The archive's bytes, entry by entry, then the central directory.
 * `zip64At` is where 32-bit fields give way to ZIP64 ones: the format's own
 * limit, lowered only by a test that cannot write 4 GiB.
 */
export async function* zip(
  entries: AsyncIterable<ZipEntry> | Iterable<ZipEntry>,
  { zip64At = LIMIT }: { zip64At?: number } = {},
): AsyncGenerator<Uint8Array> {
  const written: {
    name: Uint8Array
    time: number
    date: number
    crc: number
    compressed: number
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
    local.view.setUint16(8, DEFLATE, true)
    local.view.setUint16(10, time, true)
    local.view.setUint16(12, date, true)
    // CRC and sizes (14..25) stay zero: the descriptor carries them.
    local.view.setUint16(26, name.length, true)
    local.bytes.set(name, 30)
    yield local.bytes

    const count = { crc: 0, size: 0 }
    let compressed = 0
    for await (const piece of deflated(entry.body, count)) {
      compressed += piece.byteLength
      yield piece
    }
    if (count.size > LIMIT || compressed > LIMIT) {
      throw new Error(`${entry.name} is 4 GiB or more, past one zip entry`)
    }

    const descriptor = header(16)
    descriptor.view.setUint32(0, 0x08074b50, true)
    descriptor.view.setUint32(4, count.crc, true)
    descriptor.view.setUint32(8, compressed, true)
    descriptor.view.setUint32(12, count.size, true)
    yield descriptor.bytes

    written.push({ name, time, date, ...count, compressed, offset })
    offset += local.bytes.length + compressed + descriptor.bytes.length
  }

  let directory = 0
  for (const entry of written) {
    // Only the offset can outgrow 32 bits; its ZIP64 extra field says so.
    const wide = entry.offset >= zip64At
    const central = header(46 + entry.name.length + (wide ? 12 : 0))
    central.view.setUint32(0, 0x02014b50, true)
    central.view.setUint16(4, wide ? VERSION_ZIP64 : VERSION, true)
    central.view.setUint16(6, wide ? VERSION_ZIP64 : VERSION, true)
    central.view.setUint16(8, FLAGS, true)
    central.view.setUint16(10, DEFLATE, true)
    central.view.setUint16(12, entry.time, true)
    central.view.setUint16(14, entry.date, true)
    central.view.setUint32(16, entry.crc, true)
    central.view.setUint32(20, entry.compressed, true)
    central.view.setUint32(24, entry.size, true)
    central.view.setUint16(28, entry.name.length, true)
    central.view.setUint16(30, wide ? 12 : 0, true)
    central.view.setUint32(42, wide ? LIMIT : entry.offset, true)
    central.bytes.set(entry.name, 46)
    if (wide) {
      const extra = 46 + entry.name.length
      central.view.setUint16(extra, 0x0001, true)
      central.view.setUint16(extra + 2, 8, true)
      central.view.setBigUint64(extra + 4, BigInt(entry.offset), true)
    }
    directory += central.bytes.length
    yield central.bytes
  }

  const wide =
    written.length >= Math.min(0xffff, zip64At) ||
    offset >= zip64At ||
    directory >= zip64At
  if (wide) {
    // The ZIP64 end record, then the locator pointing back at it.
    const record = header(56 + 20)
    record.view.setUint32(0, 0x06064b50, true)
    record.view.setBigUint64(4, 44n, true) // the record's size after this field
    record.view.setUint16(12, VERSION_ZIP64, true)
    record.view.setUint16(14, VERSION_ZIP64, true)
    record.view.setBigUint64(24, BigInt(written.length), true)
    record.view.setBigUint64(32, BigInt(written.length), true)
    record.view.setBigUint64(40, BigInt(directory), true)
    record.view.setBigUint64(48, BigInt(offset), true)
    record.view.setUint32(56, 0x07064b50, true)
    record.view.setBigUint64(64, BigInt(offset + directory), true)
    record.view.setUint32(72, 1, true)
    yield record.bytes
  }
  const end = header(22)
  end.view.setUint32(0, 0x06054b50, true)
  end.view.setUint16(8, wide ? 0xffff : written.length, true)
  end.view.setUint16(10, wide ? 0xffff : written.length, true)
  end.view.setUint32(12, wide ? LIMIT : directory, true)
  end.view.setUint32(16, wide ? LIMIT : offset, true)
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
