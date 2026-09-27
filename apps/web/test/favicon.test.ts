import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

// Google Search draws no favicon from an SVG: its guide lists BMP, GIF, ICO,
// PNG, JPEG, PPM and TIFF, and recommends larger than 48x48
// (developers.google.com/search/docs/appearance/favicon-in-search, read
// 2026-09-27). With only `icon.svg`, results showed a generic globe, so
// `app/favicon.ico` carries raster copies of the mark. Next links it first as
// `/favicon.ico`, a URL that never changes, which the same guide also asks for.
test('favicon.ico is an ICO holding a raster at least 48px square', () => {
  const ico = readFileSync(
    fileURLToPath(new URL('../app/favicon.ico', import.meta.url)),
  )
  expect(ico.readUInt16LE(0)).toBe(0)
  expect(ico.readUInt16LE(2)).toBe(1)
  const count = ico.readUInt16LE(4)
  // A width byte of 0 means 256.
  const sizes = Array.from(
    { length: count },
    (_, i) => ico.readUInt8(6 + 16 * i) || 256,
  )
  expect(Math.max(...sizes)).toBeGreaterThanOrEqual(48)
})
