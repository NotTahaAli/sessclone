import { readFileSync, readdirSync } from 'node:fs'

import { describe, expect, test } from 'vitest'

// Ticket 79. The licence term in `NOTICE.md` requires the panel's Appropriate
// Legal Notices to stay visible, and in this repository they are visible for
// one reason only: both signed-in pages wrap in `Panel`, which renders
// `PanelCredit`.
//
// Nothing enforces that. A new signed-in page that builds its own `<main>`
// would ship without the notice and breach the project's own stated term
// quietly — and ticket 45 is about to rewrite this shell. `NOTICE.md` argues,
// correctly, that nothing should check for the credit *at runtime*; that is
// about other people's deployments. This is about ours, and it is a file read.

const APP = new URL('../app/', import.meta.url)

/**
 * The route segments that are not signed-in pages.
 *
 * `(marketing)` has its own frame and its own footer, `sign-in` and `auth` are
 * how somebody arrives, and `api` renders nothing. Everything else under
 * `app/` is a panel page.
 */
const NOT_SIGNED_IN = new Set(['(marketing)', 'sign-in', 'auth', 'api'])

/** Every `page.tsx` under `app/`, as a path relative to it. */
const pages = (dir: URL, prefix = ''): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return NOT_SIGNED_IN.has(entry.name)
        ? []
        : pages(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`)
    }
    return entry.name === 'page.tsx' ? [`${prefix}${entry.name}`] : []
  })

describe('the panel credit', () => {
  test('carries every notice section 0 asks for', () => {
    const source = readFileSync(new URL('panel.tsx', APP), 'utf8')
    const credit = source.slice(source.indexOf('export function PanelCredit'))

    // AGPL-3.0 section 0: a copyright notice, no warranty, that licensees may
    // convey the work under this licence, and how to view it. Plus the
    // attribution the section 7(b) term names.
    expect(credit).toContain('Copyright ©')
    expect(credit).toContain('No warranty')
    expect(credit).toContain('convey this work')
    expect(credit).toContain('LICENSE_URL')
    expect(credit).toContain('sessclone')
  })

  test('is on every signed-in page, because every one of them is a Panel', () => {
    const found = pages(APP)

    // If this is empty the walk is broken, not the repo clean.
    expect(found.length).toBeGreaterThan(0)

    for (const page of found) {
      const source = readFileSync(new URL(page, APP), 'utf8')
      expect(source, `${page} does not render <Panel>`).toContain('<Panel')
    }
  })
})
