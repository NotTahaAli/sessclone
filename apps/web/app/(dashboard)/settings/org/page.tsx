import Link from 'next/link'
import { notFound } from 'next/navigation'
import { RetentionForm } from './retention-form'
import { TimezoneForm } from './timezone-form'
import { EmptyState } from '../../empty-state'
import { PageHeader } from '../../page-header'
import { asViewer } from '../../../../lib/db'
import { listTimezones, orgRetention } from '../../../../lib/org'
import {
  currentViewer,
  reachesOrgSettings,
  reachesTier,
} from '../../../../lib/viewer'

// Org settings is tickets 51 (timezone), 61 (retention), 77 (appearance
// defaults and the logo) and 49 and 50 (Members, Roles and invitations).
// Reachable by an Owner or an Admin, which is settled in the product IA and
// wider than tickets 49, 50 and 61 each say on their own. The Tier page is
// Owner-only and is ticket 47's; it is not linked from here.

// Tier is a destination inside here rather than a section of this page, and it
// is the one page inside Org settings an Admin does not reach: `CONTEXT.md`
// gives an Admin the whole Org's data and settings with billing as the only
// exclusion. The entry below is absent for an Admin rather than present and
// refused, and `settings/tier/page.tsx` guards the URL.
//
// The nav hides this from a Manager and a Member, and hiding a link is not a
// check — the URL is typeable. ADR 0001 means the *data* is safe either way,
// because every read here is policy-scoped, but the surface is not.
export default async function Page() {
  const viewer = await currentViewer()
  if (!viewer || !reachesOrgSettings(viewer.role)) notFound()

  const [zones, retention] = await asViewer(viewer.userId, (tx) =>
    Promise.all([listTimezones(tx), orgRetention(tx, viewer.orgId)]),
  )

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="Org settings" />

      <TimezoneSetting
        orgId={viewer.orgId}
        orgName={viewer.orgName}
        current={viewer.orgTimezone}
        zones={zones}
      />

      {retention ? (
        <RetentionSetting
          orgId={viewer.orgId}
          days={retention.days}
          ceiling={retention.ceiling}
        />
      ) : null}

      <Link
        href="/settings/org/members"
        className="border-rule bg-surface hover:bg-surface-hover block rounded-md border p-4"
      >
        <span className="text-heading block">Members</span>
        <span className="text-text-secondary mt-1 block text-sm">
          Who is in this Org, and which Members each Manager may see.
        </span>
      </Link>

      {reachesTier(viewer.role) ? (
        <Link
          href="/settings/tier"
          className="border-rule bg-surface hover:bg-surface-hover block rounded-md border p-4"
        >
          <span className="text-heading block">Tier</span>
          <span className="text-text-secondary mt-1 block text-sm">
            What this Org is on: seats, price, whether transcript archival is
            available, and the ceiling your retention setting sits under.
          </span>
        </Link>
      ) : null}

      <EmptyState headline="More to come">
        Appearance defaults and invitations will live here.
      </EmptyState>
    </div>
  )
}

/**
 * The timezone the Org's days are measured in.
 *
 * Said in terms of what it changes rather than what it is: a reader choosing
 * between two names wants to know that the choice moves the boundaries on
 * every chart, and that it moves them for everybody rather than for them.
 *
 * A native `select` and a submit — the list is long and native pickers
 * type-ahead, which beats anything worth shipping here. The form itself is a
 * client component for one reason, named in `timezone-form.tsx`: a refusal
 * has to reach the reader as a sentence.
 */
function TimezoneSetting({
  orgId,
  orgName,
  current,
  zones,
}: {
  orgId: string
  orgName: string
  current: string
  zones: string[]
}) {
  return (
    <section aria-labelledby="timezone">
      <h2 id="timezone" className="text-heading-lg">
        Timezone
      </h2>
      <p className="text-text-secondary mt-2 text-sm">
        Where {orgName}&apos;s days start and end. Every chart cuts Turns into
        days at this boundary, so one chart means the same thing to everyone
        reading it.
      </p>
      <p className="text-text-muted mt-2 text-sm">
        Nothing collected is altered or lost: a Turn is stored as an instant,
        and this decides which day it is counted in.
      </p>
      {/* Said plainly, because it is about money and it is not obvious. A Rate
          is effective from a date, so the day a Turn falls on is also the day
          it is priced on — moving the boundary can move a past total by a
          cent or by a Rate revision. `turn_costs` reads this column, which is
          what makes the two answers agree; the cost of that agreement is that
          history is not frozen. */}
      <p className="text-text-muted mt-2 text-sm">
        It also re-prices: a Turn is charged at the Rate live on the Org&apos;s
        day, so a past total can change when the boundary moves.
      </p>

      <TimezoneForm orgId={orgId} current={current} zones={zones} />
    </section>
  )
}

/**
 * Ticket 61. Retention sits beside the timezone rather than with the
 * archival switch: turning archival off is a Member's own decision about
 * their machine (ADR 0005), while how long the Org keeps what it already
 * holds is the Org's.
 *
 * Both the window and the Tier's ceiling are stated, because a control that
 * silently refuses a number is worse than one that says what the bound is.
 */
function RetentionSetting({
  orgId,
  days,
  ceiling,
}: {
  orgId: string
  days: number
  ceiling: number | null
}) {
  return (
    <section aria-labelledby="retention">
      <h2 id="retention" className="text-heading-lg">
        Retention
      </h2>
      <p className="text-text-secondary mt-2 text-sm">
        How long a stored transcript is kept. Past this, the transcript and its
        record are removed together.
      </p>
      <p className="text-text-muted mt-2 text-sm">
        Usage and cost are never removed by retention. A Session&apos;s spend
        stays in the history whether or not its transcript is still here, so
        shortening this loses reading material and never money.
      </p>
      <p className="text-text-muted mt-2 text-sm">
        {ceiling === null
          ? 'This Tier sets no ceiling, so the window is yours to choose.'
          : `This Tier allows up to ${ceiling} days.`}
      </p>

      <RetentionForm orgId={orgId} current={days} ceiling={ceiling} />
    </section>
  )
}
