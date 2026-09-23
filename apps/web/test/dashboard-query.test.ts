import { describe, expect, it } from 'vitest'

import { hrefWith } from '../app/(dashboard)/query'

// Ticket 112: every header pill and every Finder-column row is a link that
// changes one key and must keep the others.
describe('hrefWith', () => {
  it('keeps the period and filters, sets the one key', () => {
    expect(
      hrefWith('/sessions', { range: 'last-7', member: 'm1' }, { open: 'x' }),
    ).toBe('/sessions?range=last-7&member=m1&open=x')
  })

  it('removes a key patched to undefined or empty', () => {
    expect(
      hrefWith('/costs', { view: 'projects', open: 'p' }, { open: undefined }),
    ).toBe('/costs?view=projects')
    expect(hrefWith('/costs', { view: 'projects' }, { view: '' })).toBe(
      '/costs',
    )
  })

  it('drops a page cursor and reads the first of a repeated key', () => {
    expect(
      hrefWith('/sessions', { before: 'a,b', q: ['one', 'two'] }, {}),
    ).toBe('/sessions?q=one')
  })
})
