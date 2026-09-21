import { REPOSITORY } from '../(marketing)/constants'

// Ticket 79's Appropriate Legal Notices, which ticket 45 moved out of the
// `Panel` frame and into the shell.
//
// `Panel` was the stand-in every signed-in page wrapped in until this shell
// existed: a header saying who was signed in, a way out, and this credit. The
// header and the sign-out are the shell's now — the Org name and the Role are
// in the frame and sign out is in the account menu — and what is left is the
// part the licence turns on, rendered once by `layout.tsx` so that it is on
// every signed-in page by construction rather than by each page remembering.

/** Where the licence, its additional term and the source all live. */
export const LICENSE_URL = `${REPOSITORY}/blob/main/LICENSE`
export const NOTICE_URL = `${REPOSITORY}/blob/main/NOTICE.md`

/**
 * The panel's Appropriate Legal Notices, and the sessclone credit with them
 * (ticket 79). "The panel" is now the dashboard shell; the term in
 * `NOTICE.md` is about what a person sees, not about which file renders it.
 *
 * This is deliberately not a "Powered by" line on its own. AGPL-3.0 section
 * 7(b) permits an additional term requiring preservation of "legal notices or
 * author attributions in that material or in the Appropriate Legal Notices
 * displayed by works containing it" — so a term hung on a marketing sentence
 * is not a 7(b) term at all, and section 7 hands a recipient the right to
 * strip any non-permissive term that is not one of (a) to (f).
 *
 * Section 0 says what an interactive interface has to show to be displaying
 * Appropriate Legal Notices: a copyright notice, that there is no warranty,
 * that licensees may convey the work under this licence, and how to read it.
 * All four are below, which is what the additional term in `NOTICE.md`
 * actually requires be preserved.
 *
 * It is ordinary markup in an open repository — of course it can be deleted.
 * Nothing checks for it at runtime and nothing will: a tamper check would make
 * a worse promise than the licence already makes. Deleting it and conveying or
 * network-deploying the result is a licence breach, which is a different kind
 * of problem from a technical one, and the honest place to put it.
 */
export function PanelCredit() {
  return (
    <footer className="border-rule text-caption text-text-muted mt-10 flex flex-col gap-1 border-t pt-4 lg:mt-0 lg:border-t-0 lg:pt-0">
      <p>
        Powered by{' '}
        <a href={REPOSITORY} className="hover:text-accent-text underline">
          sessclone
        </a>{' '}
        · Copyright © 2026 sessclone contributors
      </p>
      <p>
        No warranty, to the extent permitted by law. You may convey this work
        under the{' '}
        <a href={LICENSE_URL} className="hover:text-accent-text underline">
          GNU AGPL v3
        </a>
        , with the{' '}
        <a href={NOTICE_URL} className="hover:text-accent-text underline">
          additional term
        </a>{' '}
        that keeps this notice visible.
      </p>
    </footer>
  )
}
