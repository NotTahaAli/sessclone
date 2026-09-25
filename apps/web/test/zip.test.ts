import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from 'vitest'
import { z } from 'zod'

import { zip } from '../lib/zip'

// Ticket 140's writer, read back by somebody else's reader: Python's
// `zipfile` checks every CRC and size against the central directory, which
// is what an unzip tool on the other end will do. `zip64At: 0` makes every
// field that can go wide go wide, which is the only way to reach the ZIP64
// path without writing 4 GiB.

async function* pieces(...texts: string[]) {
  for (const text of texts) yield new TextEncoder().encode(text)
}

const entries = () => [
  {
    name: 'ada@acme.test/github.com-acme-api/s-1.jsonl',
    modified: new Date('2026-09-25T10:20:30Z'),
    body: pieces('{"a":1}\n', '{"b":2}\n'.repeat(500)),
  },
  {
    name: 'ada@acme.test/outside-a-repository/ünïcode.jsonl',
    modified: new Date('2026-09-24T00:00:00Z'),
    body: pieces(),
  },
]

const Read = z.record(
  z.string(),
  z.tuple([z.string(), z.array(z.number()), z.number()]),
)

/** What Python makes of the archive: each entry's text, time and method. */
const readBack = async (bytes: AsyncIterable<Uint8Array>) => {
  const parts: Uint8Array[] = []
  for await (const part of bytes) parts.push(part)
  const dir = mkdtempSync(join(tmpdir(), 'zip-'))
  try {
    const file = join(dir, 'all.zip')
    writeFileSync(file, Buffer.concat(parts))
    return {
      size: Buffer.concat(parts).byteLength,
      entries: Read.parse(
        JSON.parse(
          execFileSync(
            'python3',
            [
              '-c',
              `import json, sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None
print(json.dumps({i.filename: [z.read(i).decode(), list(i.date_time), i.compress_type] for i in z.infolist()}))`,
              file,
            ],
            { encoding: 'utf8' },
          ),
        ),
      ),
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const expected = {
  'ada@acme.test/github.com-acme-api/s-1.jsonl': [
    '{"a":1}\n' + '{"b":2}\n'.repeat(500),
    [2026, 9, 25, 10, 20, 30],
    8,
  ],
  'ada@acme.test/outside-a-repository/ünïcode.jsonl': [
    '',
    [2026, 9, 24, 0, 0, 0],
    8,
  ],
}

test('a streamed zip opens elsewhere with every entry intact and deflated', async () => {
  const { size, entries: read } = await readBack(zip(entries()))
  expect(read).toEqual(expected)
  // 4 KB of JSONL is well under 1 KB once deflated.
  expect(size).toBeLessThan(1000)
})

test('past the 32-bit limits the archive goes ZIP64 and still opens', async () => {
  const { entries: read } = await readBack(zip(entries(), { zip64At: 0 }))
  expect(read).toEqual(expected)
})

test('an entry past 4 GiB gets 64-bit sizes in its descriptor and directory', async () => {
  const parts: Uint8Array[] = []
  for await (const part of zip(entries().slice(0, 1), { zip64At: 0 })) {
    parts.push(part)
  }
  const bytes = Buffer.concat(parts)
  // The descriptor runs from its signature to the central directory's.
  const descriptor = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x07, 0x08]))
  const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  expect(central - descriptor).toBe(24)
  // Both 32-bit sizes say "see the ZIP64 extra".
  expect(bytes.readUInt32LE(central + 20)).toBe(0xffff_ffff)
  expect(bytes.readUInt32LE(central + 24)).toBe(0xffff_ffff)
})
