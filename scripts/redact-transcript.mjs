// Turns a real Claude Code transcript into a committable fixture. All of the
// judgement lives in redactEntry, which is unit-tested; this is the file
// handling around it and deliberately has no rules of its own.
//
//   node --experimental-strip-types scripts/redact-transcript.mjs <in> <out>
//
// Node 22 needs the flag to import the TypeScript source directly; the
// alternative is a build step for one function.
import { readFileSync, writeFileSync } from 'node:fs'

import { redactEntry } from '../packages/shared/src/redact.ts'

const [input, output] = process.argv.slice(2)
if (!input || !output) {
  console.error('usage: redact-transcript.mjs <input.jsonl> <output.jsonl>')
  process.exit(1)
}

const redacted = readFileSync(input, 'utf8')
  .split('\n')
  .filter((line) => line !== '')
  .map((line) => JSON.stringify(redactEntry(JSON.parse(line))))
  .join('\n')

writeFileSync(output, `${redacted}\n`)
