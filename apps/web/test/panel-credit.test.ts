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
/**
 * Every frame that renders the notices. A signed-in page belongs under one of
 * them, and each of them is checked below — so the rule is "a signed-in page
 * is inside a frame that carries the credit" rather than "inside this one
 * folder", which is what ticket 62's admin area made the difference between.
 */
const SHELLS = ['(dashboard)', 'admin']
const SHELL = SHELLS[0]!

/**
 * The route segments that are not signed-in pages.
 *
 * `(marketing)` has its own frame and its own footer, `sign-in` and `auth` are
 * how somebody arrives, and `api` renders nothing. Everything else under
 * `app/` is a signed-in page and belongs under the shell.
 */
const NOT_SIGNED_IN = new Set([
  '(marketing)',
  'sign-in',
  // The waitlist, split from `sign-in` (2026-09-24): an arrival path too.
  'sign-up',
  'auth',
  'api',
  // `join` is ticket 49's: whoever opens an invitation may have no account
  // yet, so it is an arrival path like `sign-in` rather than a signed-in page.
  // It is outside every shell and renders `PanelCredit` itself, which the case
  // below checks rather than taking on trust.
  'join',
  // Ticket 116: the public docs, read before anybody has an account. Public
  // like `(marketing)`, not a panel page, so the panel's notice is not theirs.
  'docs',
  // Ticket 136: signed in, but outside the shell on purpose — the shell
  // covers every page with the waiting page while the current Org waits, and
  // New Org must be reachable from there. It renders `PanelCredit` itself,
  // checked below.
  'new-org',
])

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

/** Every file under `dir`, as a path relative to it. */
const filesUnder = (dir: URL, prefix = ''): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? filesUnder(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`)
      : [`${prefix}${entry.name}`],
  )

describe('the panel credit', () => {
  const source = readFileSync(new URL(`${SHELL}/credit.tsx`, APP), 'utf8')
  const between = (from: string, to: string) =>
    source.slice(source.indexOf(from), source.indexOf(to))

  test('the notice carries every item section 0 asks for', () => {
    const notice = source.slice(source.indexOf('export function LegalNotice'))

    // AGPL-3.0 section 0: a copyright notice, no warranty, that licensees may
    // convey the work under this licence, and how to view it. Plus the
    // attribution the section 7(b) term names.
    expect(notice).toContain('Copyright ©')
    expect(notice).toContain('no warranty')
    expect(notice).toContain('convey this work')
    expect(notice).toContain('LICENSE_URL')
    expect(notice).toContain('NOTICE_URL')
    expect(notice).toContain('SessClone')
  })

  test('the credit line names SessClone and the licence, and opens the notice', () => {
    // 2026-09-23: one line, "Powered by SessClone · AGPL-3.0 · Legal", whose
    // Legal button is the prominently visible feature section 0 asks for.
    const credit = between(
      'export function PanelCredit',
      'export function LegalButton',
    )
    expect(credit).toContain('SessClone')
    expect(credit).toContain('AGPL-3.0')
    expect(credit).toContain('<LegalButton />')

    const button = between('export function LegalButton', '/**\n * The full')
    expect(button).toContain('popoverTarget={LEGAL_NOTICE_ID}')
  })

  test('the account block carries Legal where the sidebar credit leaves it out', () => {
    const account = readFileSync(new URL(`${SHELL}/account.tsx`, APP), 'utf8')
    const layout = readFileSync(new URL(`${SHELL}/layout.tsx`, APP), 'utf8')

    expect(account).toContain('<LegalButton />')
    expect(layout).toContain('<AccountBlock')
  })

  // 2026-09-23 review: the sidebar's credit was `legal={false}` on the
  // assumption the account block sat above it, but `Account()` renders
  // nothing without a viewer and its Suspense fallback was nothing, so the
  // desktop sidebar could show no Legal button at all. The credit leaves Legal
  // out only beside an account block, inside `Account()`, and every other
  // path — no viewer, still loading — renders the full credit.
  test('the desktop sidebar has a Legal button with or without an account block', () => {
    const layout = readFileSync(new URL(`${SHELL}/layout.tsx`, APP), 'utf8')
    const account = layout.slice(
      layout.indexOf('async function Account()'),
      layout.indexOf('async function HeaderAccount()'),
    )

    expect(layout.match(/<PanelCredit legal=\{false\} \/>/g)).toHaveLength(1)
    expect(account).toMatch(
      /<AccountBlock viewer=\{viewer\} \/>\s*<PanelCredit legal=\{false\} \/>/,
    )
    expect(account).toMatch(/:\s*\(?\s*<PanelCredit \/>/)
    expect(layout).toContain('const PENDING_CREDIT = <PanelCredit />')
    expect(layout).toMatch(
      /<Suspense fallback=\{PENDING_CREDIT\}>\s*<Account \/>/,
    )
  })

  test.each(SHELLS)(
    'is rendered by the %s shell that its signed-in pages hang from',
    (shell) => {
      const layout = readFileSync(new URL(`${shell}/layout.tsx`, APP), 'utf8')

      expect(layout).toContain('PanelCredit')
      // At least twice: the sidebar carries it at desktop width and the
      // content column carries it at phone width, where there is no sidebar
      // to carry anything. (The dashboard's sidebar has three, one per state
      // of its account block; the case above checks those.)
      expect(
        layout.match(/<PanelCredit( legal=\{false\})? \/>/g)?.length,
      ).toBeGreaterThanOrEqual(2)
    },
  )

  test('the invitation page carries the credit itself, being outside the shell', () => {
    const join = readFileSync(new URL('join/[token]/page.tsx', APP), 'utf8')

    expect(join).toContain('<PanelCredit />')
  })

  test('the New Org page carries the credit itself, being outside the shell', () => {
    const newOrg = readFileSync(new URL('new-org/page.tsx', APP), 'utf8')

    expect(newOrg).toContain('<PanelCredit />')
  })

  test('the sign-up page carries the credit itself, being outside the shell', () => {
    const signUp = readFileSync(new URL('sign-up/page.tsx', APP), 'utf8')

    expect(signUp).toContain('<PanelCredit />')
  })

  // 2026-09-23 review: sign-in rendered `PanelCredit` and no `LegalNotice`, so
  // its Legal button opened nothing. The notice is the root layout's now —
  // on every page by construction, and once: an id twice on one page opens
  // whichever the browser finds first, and a notice inside a frame's
  // phone-only column would be `display: none` at desktop width.
  test('every page has the notice its Legal buttons open, exactly once', () => {
    const root = readFileSync(new URL('layout.tsx', APP), 'utf8')
    expect(root.match(/<LegalNotice \/>/g)).toHaveLength(1)

    expect(
      filesUnder(APP).filter(
        (file) =>
          file.endsWith('.tsx') &&
          file !== 'layout.tsx' &&
          readFileSync(new URL(file, APP), 'utf8').includes('<LegalNotice'),
      ),
    ).toEqual([])
  })

  test('is on every signed-in page, because every one of them is in the shell', () => {
    const found = pages(APP)

    // If this is empty the walk is broken, not the repo clean.
    expect(found.length).toBeGreaterThan(0)

    for (const page of found) {
      expect(
        SHELLS.some((shell) => page.startsWith(`${shell}/`)),
        `${page} is a signed-in page outside every shell that renders the notices`,
      ).toBe(true)
    }
  })
})
