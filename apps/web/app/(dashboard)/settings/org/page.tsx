import Link from 'next/link'
import { notFound } from 'next/navigation'
import { setTimezone } from './actions'
import { EmptyState } from '../../empty-state'
import { PageHeader } from '../../page-header'
import { asViewer } from '../../../../lib/db'
import { listTimezones } from '../../../../lib/org'
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

  const zones = await asViewer(viewer.userId, (tx) => listTimezones(tx))

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="Org settings" />

      <TimezoneSetting
        orgId={viewer.orgId}
        orgName={viewer.orgName}
        current={viewer.orgTimezone}
        zones={zones}
      />

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
        Retention, appearance defaults and invitations will live here.
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
 * A plain `form` with a `select` and a submit, so the page works as a Server
 * Component with no client JavaScript. The list is long and native pickers
 * type-ahead, which is better than anything worth shipping here.
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
        Changing it re-draws the charts you already have. Nothing that has been
        collected is altered or lost — a Turn is stored as an instant, and this
        only decides which day it is counted in.
      </p>

      <form action={setTimezone} className="mt-4 flex flex-wrap gap-3">
        <input type="hidden" name="orgId" value={orgId} />
        <label className="sr-only" htmlFor="timezone-select">
          Timezone
        </label>
        <select
          id="timezone-select"
          name="timezone"
          defaultValue={current}
          className="border-control-border text-text rounded border px-3 py-1 text-sm"
        >
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="border-control-border text-text rounded border px-3 py-1 text-sm"
        >
          Save timezone
        </button>
      </form>
    </section>
  )
}
