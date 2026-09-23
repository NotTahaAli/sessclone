import { readFileSync } from 'node:fs'

import { splitChunk } from './chunk.ts'
import { parseLines } from './parse.ts'

const DIRECTORY = new URL('../../fixtures/transcript-viewer/', import.meta.url)

export const fixtureText = (name: string) =>
  readFileSync(new URL(name, DIRECTORY), 'utf8')

/** Parse a whole synthetic fixture the way the viewer would. */
export const loadFixture = (name: string) =>
  parseLines(
    splitChunk(new Uint8Array(readFileSync(new URL(name, DIRECTORY))), 0, {
      atFileStart: true,
      atFileEnd: true,
    }).lines,
  )
