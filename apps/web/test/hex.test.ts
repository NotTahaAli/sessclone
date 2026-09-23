import { describe, expect, it } from 'vitest'

import { canonicalHex } from '../lib/accent-presets'

// Ticket 113: the custom accent swatch checks a typed hex in the browser
// before it is posted. `readSeed` on the server still decides (and refuses a
// grey), but the two must agree on what is a hex at all.
describe('canonicalHex', () => {
  it('canonicalises any spelling of one colour', () => {
    for (const typed of ['#d97757', 'D97757', ' #D97757 ']) {
      expect(canonicalHex(typed)).toBe('#D97757')
    }
  })

  it('expands three-digit shorthand', () => {
    expect(canonicalHex('#f0a')).toBe('#FF00AA')
    expect(canonicalHex('3d6')).toBe('#33DD66')
  })

  it('refuses what is not a hex', () => {
    for (const typed of ['', '#', '#12345', '#1234567', 'blue', '#GGGGGG']) {
      expect(canonicalHex(typed)).toBeNull()
    }
  })
})
