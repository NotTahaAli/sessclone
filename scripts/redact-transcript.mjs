// Turns a real Claude Code transcript into a committable fixture. All of the
// judgement lives in redactJsonl, which is unit-tested; this is the file
// handling around it and deliberately has no rules of its own.
//
//   node --experimental-strip-types scripts/redact-transcript.mjs <in> <out>
//
// Node 22 needs the flag to import the TypeScript source directly; the
// alternative is a build step for one function.
import { readFileSync, writeFileSync } from 'node:fs'

import { redactJsonl } from '../packages/shared/src/redact.ts'

const usage = 'usage: redact-transcript.mjs <input.jsonl> <output.jsonl>'
const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  console.log(usage)
  process.exit(0)
}

const [input, output] = args
if (!input || !output) {
  console.error(usage)
  process.exit(1)
}

// All of the rules, including the refusal of already-redacted input, live in
// redactJsonl; only the file name is added here.
let redacted
try {
  redacted = redactJsonl(readFileSync(input, 'utf8'))
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  // A line number joins the file name as `<input>:<n>`, like a compiler's.
  console.error(`${input}:${/^\d/.test(message) ? '' : ' '}${message}`)
  process.exit(1)
}

writeFileSync(output, redacted)
