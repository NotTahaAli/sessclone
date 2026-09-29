import { describe, expect, it } from 'vitest'

import { menuRight } from '../app/_ui/pill-menu'

// The header pill menu's placement: right edges aligned under the pill, and
// never off the screen (the phone Costs bug, ticket 145).

describe('menuRight', () => {
  it('aligns the menu with a pill on the right', () => {
    expect(menuRight(1440, 1400)).toBe(40)
  })

  it('keeps 8px from the right edge', () => {
    expect(menuRight(390, 388)).toBe(8)
  })

  it('keeps a pill near the left edge from pushing the menu off it', () => {
    // A 256px menu under a pill ending at 150px: left edge at 8px, not -106px.
    expect(menuRight(390, 150)).toBe(390 - 256 - 8)
  })

  it('fits a screen narrower than the menu', () => {
    expect(menuRight(200, 100)).toBe(8)
  })
})
