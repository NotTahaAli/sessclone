// Ticket 83: the static shells are real, and carry nobody's data.
//
// `next build` writes one HTML file per prerendered route. A route that opts
// out of static shell validation writes an empty one — which is what every
// signed-in route did before this ticket, and what a page added later would
// do again the moment somebody wrapped a session read outside a Suspense
// boundary. A zero-byte shell is not an error to Next, so it is checked here
// and run in CI after the build.
//
// The second half matters more: a shell is served to whoever asks, before
// anybody is identified. Anything viewer-specific inside one is a leak, so
// the prerendered HTML is searched for the things that identify a person.
//
// Usage: node scripts/check-shells.mjs [apps/web/.next/server/app]

import { readFileSync } from 'node:fs'
import { argv, exit } from 'node:process'

const ROOT = argv[2] ?? 'apps/web/.next/server/app'

/** Routes whose shell must exist and must not be empty. */
const SHELLS = [
  'costs.html',
  'sessions.html',
  'transcripts.html',
  'more.html',
  'devices.html',
  'keys.html',
  'settings.html',
  'settings/you.html',
  'sign-in.html',
  'pricing.html',
]

/**
 * What must never appear in a prerendered shell, because a shell is built
 * without a request and is then served to whoever asks.
 *
 * `.test` addresses are the fixtures' own — an address in a shell came from
 * the build's database rather than from a viewer. "Sign out" is the account
 * menu, which only renders once a session has been read. The marketing
 * pages' own `mailto:` and the sign-in field's placeholder are copy, so the
 * live domains are deliberately not matched here.
 */
const FORBIDDEN = [/@[\w.-]+\.test\b/, /Sign out/]

const problems = []

for (const shell of SHELLS) {
  let html
  try {
    html = readFileSync(`${ROOT}/${shell}`, 'utf8')
  } catch {
    problems.push(`${shell} was not prerendered at all`)
    continue
  }

  if (html.trim() === '') {
    problems.push(
      `${shell} is an empty shell — the route reads request data outside a Suspense boundary, or carries \`export const instant = false\``,
    )
    continue
  }

  for (const pattern of FORBIDDEN) {
    if (pattern.test(html)) {
      problems.push(
        `${shell} contains ${pattern} — that is a viewer's data in a page served to everybody`,
      )
    }
  }
}

if (problems.length > 0) {
  console.error(`static shells: ${problems.length} problem(s)`)
  for (const problem of problems) console.error(`  - ${problem}`)
  exit(1)
}

console.log(
  `static shells: ${SHELLS.length} checked, all non-empty and anonymous`,
)
