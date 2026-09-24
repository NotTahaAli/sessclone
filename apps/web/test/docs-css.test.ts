import { readFileSync } from 'node:fs'

import { expect, test } from 'vitest'

// Taha, 2026-09-23: after a visit to `/docs`, a client navigation to the
// dashboard drew it with no sidebar. React never removes a stylesheet it has
// inserted, so `docs.css` stays on every page after the docs; it re-emitted
// `.hidden` for the docs' own files alone (`source(none)`), later in the same
// `utilities` layer than the app's `lg:flex`, and won. The docs sheet must
// generate its utilities from the whole app, so its copy of any app class is
// in Tailwind's order too.

test('the docs stylesheet generates the app’s utilities, not only its own', () => {
  const css = readFileSync(
    new URL('../app/docs/docs.css', import.meta.url),
    'utf8',
  )
  const utilities = css.match(/@import\s+'tailwindcss\/utilities\.css'[^;]*;/)
  expect(utilities).not.toBeNull()
  expect(utilities![0]).toContain('layer(utilities)')
  expect(utilities![0]).not.toMatch(/source\(/)
})
