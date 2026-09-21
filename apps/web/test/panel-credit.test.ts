import { readFileSync, readdirSync } from 'node:fs'

import { describe, expect, test } from 'vitest'

// Ticket 79. The licence term in `NOTICE.md` requires the panel's Appropriate
// Legal Notices to stay visible, and in this repository they are visible for
// one reason only: every signed-in page renders inside the dashboard shell,
// and the shell renders `PanelCredit`.
//
// Nothing enforces that. A signed-in page added outside the shell's route
// group would ship without the notice and breach the project's own stated term
// quietly. `NOTICE.md` argues, correctly, that nothing should check for the
// credit *at runtime*; that is about other people's deployments. This is about
// ours, and it is a file read.
//
// Ticket 45 rewrote the shell, which this file was written in anticipation of:
// the credit moved from `app/panel.tsx` — the frame each page wrapped in by
// hand — to `app/(dashboard)/credit.tsx`, rendered once by the group's layout.
// The check moved with it, and got stronger: a page is covered by *being* in
// the group rather than by remembering a wrapper.

const APP = new URL('../app/', import.meta.url)
const SHELL = '(dashboard)'

/**
 * The route segments that are not signed-in pages.
 *
 * `(marketing)` has its own frame and its own footer, `sign-in` and `auth` are
 * how somebody arrives, and `api` renders nothing. Everything else under
 * `app/` is a signed-in page and belongs under the shell.
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
    const source = readFileSync(new URL(`${SHELL}/credit.tsx`, APP), 'utf8')
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

  test('is rendered by the shell that every signed-in page hangs from', () => {
    const layout = readFileSync(new URL(`${SHELL}/layout.tsx`, APP), 'utf8')

    expect(layout).toContain('PanelCredit')
    // Twice: the sidebar carries it at desktop width and the content column
    // carries it at phone width, where there is no sidebar to carry anything.
    // One of the two is visible at a time, and neither width is without it.
    expect(layout.match(/<PanelCredit \/>/g)).toHaveLength(2)
  })

  test('is on every signed-in page, because every one of them is in the shell', () => {
    const found = pages(APP)

    // If this is empty the walk is broken, not the repo clean.
    expect(found.length).toBeGreaterThan(0)

    for (const page of found) {
      expect(page, `${page} is a signed-in page outside the shell`).toContain(
        `${SHELL}/`,
      )
    }
  })
})
