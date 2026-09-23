import { CONTACT_EMAIL, ISSUES } from './constants'

/**
 * What stands where the plans go when the Tiers could not be read.
 *
 * `marketingTiers()` answers empty rather than throwing when the database is
 * unreachable, so a build with no database still produces a site and a blip
 * does not take the pricing page down with it. Naming a price here would put
 * one back in the source, which is the thing ticket 80 removed — so this says
 * plainly that the numbers are missing and gives the visitor somewhere to go.
 */
export function TiersUnavailable() {
  return (
    <p className="text-text-muted py-3 text-body">
      The plans are not loading right now. This page reads the prices live, and
      the read failed. Try again in a minute, or{' '}
      {CONTACT_EMAIL ? (
        <>
          <a className="text-text underline" href={`mailto:${CONTACT_EMAIL}`}>
            email us
          </a>{' '}
          and we will tell you what a plan costs.
        </>
      ) : (
        <>
          <a className="text-text underline" href={ISSUES}>
            ask on the project’s issues
          </a>
          .
        </>
      )}
    </p>
  )
}
