import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from 'vitest'

import { zip } from '../lib/zip'

// Ticket 140's writer, read back by somebody else's reader: Python's
// `zipfile` checks every CRC and size against the central directory, which
// is what an unzip tool on the other end will do.

async function* pieces(...texts: string[]) {
  for (const text of texts) yield new TextEncoder().encode(text)
}

test('a streamed zip opens elsewhere with every entry intact', async () => {
  const parts: Uint8Array[] = []
  for await (const part of zip([
    {
      name: 'ada@acme.test/github.com-acme-api/s-1.jsonl',
      modified: new Date('2026-09-25T10:20:30Z'),
      body: pieces('{"a":1}\n', '{"b":2}\n'),
    },
    {
      name: 'ada@acme.test/outside-a-repository/ünïcode.jsonl',
      modified: new Date('2026-09-24T00:00:00Z'),
      body: pieces(),
    },
  ]))
    parts.push(part)

  const dir = mkdtempSync(join(tmpdir(), 'zip-'))
  try {
    const file = join(dir, 'all.zip')
    writeFileSync(file, Buffer.concat(parts))
    const read = execFileSync(
      'python3',
      [
        '-c',
        `import json, sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None
print(json.dumps({i.filename: [z.read(i).decode(), list(i.date_time)] for i in z.infolist()}))`,
        file,
      ],
      { encoding: 'utf8' },
    )
    expect(JSON.parse(read)).toEqual({
      'ada@acme.test/github.com-acme-api/s-1.jsonl': [
        '{"a":1}\n{"b":2}\n',
        [2026, 9, 25, 10, 20, 30],
      ],
      'ada@acme.test/outside-a-repository/ünïcode.jsonl': [
        '',
        [2026, 9, 24, 0, 0, 0],
      ],
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
