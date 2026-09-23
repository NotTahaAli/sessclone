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

/** The one notice element per page; every Legal button opens it. */
export const LEGAL_NOTICE_ID = 'legal-notice'

const LINK = 'hover:text-accent-text underline'

/**
 * The panel's Appropriate Legal Notices, and the sessclone credit with them
 * (ticket 79). "The panel" is now the dashboard shell; the term in
 * `NOTICE.md` is about what a person sees, not about which file renders it.
 *
 * Since 2026-09-23 they are two pieces. `PanelCredit` is one visible line on
 * every signed-in page — the attribution, the licence, and a Legal button —
 * and `LegalNotice` is what that button opens: the full notices, in a native
 * popover in the top layer. Section 0 accepts exactly this shape: an
 * interface displays Appropriate Legal Notices when it has "a convenient and
 * prominently visible feature" that shows them, and a Legal item on every
 * page is that feature. The popover needs no JavaScript: `popovertarget` is
 * the browser's.
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
 * All four are in `LegalNotice`, which is what the additional term in
 * `NOTICE.md` actually requires be preserved.
 *
 * It is ordinary markup in an open repository — of course it can be deleted.
 * Nothing checks for it at runtime and nothing will: a tamper check would make
 * a worse promise than the licence already makes. Deleting it and conveying or
 * network-deploying the result is a licence breach, which is a different kind
 * of problem from a technical one, and the honest place to put it.
 */
export function PanelCredit({
  legal = true,
}: {
  /** False where a Legal button already sits just above, as in the desktop
   * sidebar's account block: one button per place, never two. */
  legal?: boolean
}) {
  return (
    <footer className="border-rule text-caption text-text-muted mt-10 border-t pt-4 lg:mt-0 lg:border-t-0 lg:pt-0">
      <p>
        Powered by{' '}
        <a href={REPOSITORY} className={LINK}>
          SessClone
        </a>
        {' · '}
        <a href={LICENSE_URL} className={LINK}>
          AGPL-3.0
        </a>
        {legal ? (
          <>
            {' · '}
            <LegalButton />
          </>
        ) : null}
      </p>
    </footer>
  )
}

/** Opens the notices. A button, since it opens something rather than going
 * somewhere; drawn as the links beside it are. */
export function LegalButton() {
  return (
    <button
      type="button"
      popoverTarget={LEGAL_NOTICE_ID}
      className={`${LINK} cursor-pointer`}
    >
      Legal
    </button>
  )
}

/**
 * The full Appropriate Legal Notices. Rendered once, by the root layout, so
 * every page with a Legal button has it; closed until one opens it; the browser gives it
 * the top layer, Escape and light dismiss.
 */
export function LegalNotice() {
  return (
    <div
      id={LEGAL_NOTICE_ID}
      popover="auto"
      role="dialog"
      aria-labelledby={`${LEGAL_NOTICE_ID}-title`}
      className="bg-ground text-text border-rule shadow-overlay m-auto w-[min(32rem,calc(100vw-2rem))] rounded-lg border p-5 text-body backdrop:bg-black/30"
    >
      <h2 id={`${LEGAL_NOTICE_ID}-title`} className="text-heading">
        Legal
      </h2>
      <div className="text-text-secondary mt-3 flex flex-col gap-2.5">
        <p>Copyright © 2026 SessClone contributors.</p>
        <p>
          This program comes with no warranty, to the extent permitted by
          applicable law.
        </p>
        <p>
          You may convey this work under the{' '}
          <a href={LICENSE_URL} className={LINK}>
            GNU Affero General Public License v3
          </a>
          , with the{' '}
          <a href={NOTICE_URL} className={LINK}>
            additional term
          </a>{' '}
          that keeps these notices visible.
        </p>
        <p>
          Powered by{' '}
          <a href={REPOSITORY} className={LINK}>
            SessClone
          </a>
          , whose source is open to read and run.
        </p>
      </div>
      <button
        type="button"
        popoverTarget={LEGAL_NOTICE_ID}
        popoverTargetAction="hide"
        className="text-text-muted hover:text-text mt-4 cursor-pointer text-caption"
      >
        Close
      </button>
    </div>
  )
}
