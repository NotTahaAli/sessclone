import Link from 'next/link'
import { notFound } from 'next/navigation'
import { setOrgSeed } from './appearance-actions'
import { setOrgName } from './actions'
import { InlineName } from '../../inline-name'
import { LockForm } from './lock-form'
import { RetentionForm } from './retention-form'
import { TimezoneForm } from './timezone-form'
import { AccentPreview } from '../appearance-preview'
import { SeedPicker } from '../seed-picker'
import { LogoForm } from './logo-form'
import { PageHeader } from '../../page-header'
import { viewerAppearance } from '../../../../lib/appearance'
import { orgLogoSrc } from '../../../../lib/org-logo'
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

  const [zones, retention, appearance, logo] = await asViewer(
    viewer.userId,
    (tx) =>
      Promise.all([
        listTimezones(tx),
        orgRetention(tx, viewer.orgId),
        viewerAppearance(tx),
        orgLogoSrc(tx, viewer.orgId),
      ]),
  )

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="Org settings" />

      {/* Ticket 101. A pencil, as every other name is: one short string. */}
      <section aria-labelledby="org-name">
        <h2 id="org-name" className="text-heading-lg">
          Name
        </h2>
        <p className="text-text-secondary mt-2 mb-3 text-sm">
          What everybody in this Org sees in the navigation and in the
          invitations you send.
        </p>
        <p className="text-body">
          <InlineName
            action={setOrgName}
            hidden={`orgId=${viewer.orgId}`}
            current={viewer.orgName}
            fallback={viewer.orgName}
            label="The Org’s name"
            placeholder="Acme"
          />
        </p>
      </section>

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
          effective={retention.effective}
          ceiling={retention.ceiling}
          lastSwept={retention.lastSwept}
        />
      ) : null}

      <section aria-labelledby="appearance" className="mt-8">
        <h2 id="appearance" className="text-heading-lg">
          Appearance
        </h2>
        <p className="text-text-secondary mt-2 text-sm">
          One colour decides the product&apos;s accent: buttons, links, the
          active navigation underline and a single-series chart. Everything else
          — the ground, the text, the status colours and the chart palette — is
          fixed, so changing this recolours the product without recolouring what
          it means.
        </p>

        <SeedPicker
          action={setOrgSeed}
          field="orgId"
          rowId={viewer.orgId}
          current={appearance.orgSeed}
          orgSeed={appearance.orgSeed}
          label="The Org’s accent colour"
        />

        <LockForm orgId={viewer.orgId} locked={appearance.locked} />

        {/* The Org's own colour, not the viewer's: an Owner who chose a
            different seed for themselves is still editing the Org's here. */}
        <AccentPreview seed={appearance.orgSeed} tones={appearance.orgTones} />
      </section>

      <Link
        href="/settings/org/members"
        className="border-rule bg-surface hover:bg-surface-hover block rounded-md border p-4"
      >
        <span className="text-heading block">Members</span>
        <span className="text-text-secondary mt-1 block text-sm">
          Who is in this Org, and which Members each Manager may see.
        </span>
      </Link>

      {/* Ticket 121. Listed for every Owner and Admin: the page says so when
          the plan does not include writing them, and shows the rows either
          way, since every Member's costs are priced from them. */}
      <Link
        href="/settings/org/rates"
        className="border-rule bg-surface hover:bg-surface-hover block rounded-md border p-4"
      >
        <span className="text-heading block">Rates</span>
        <span className="text-text-secondary mt-1 block text-sm">
          The per-model rates this Org&apos;s costs are estimated at, where they
          differ from the published prices.
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

      <section aria-labelledby="logo" className="mt-8">
        <h2 id="logo" className="text-heading-lg">
          Logo
        </h2>
        <p className="text-text-secondary mt-2 text-sm">
          The mark beside {viewer.orgName} in the navigation, on the sign-in
          page somebody reaches from an invitation, and in the invitation email
          itself. Only an Owner or an Admin can change or remove it.
        </p>

        <LogoForm orgId={viewer.orgId} orgName={viewer.orgName} src={logo} />
      </section>
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
/** A date a person reads, for "retention last ran". */
const SWEPT = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
})

function RetentionSetting({
  orgId,
  days,
  effective,
  ceiling,
  lastSwept,
}: {
  orgId: string
  days: number
  /** The window in force, which is lower than `days` after a Tier shrinks. */
  effective: number
  ceiling: number | null
  lastSwept: Date | null
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

      {/* The setting and the window in force part company when a Tier shrinks
          under an Org: the trigger cannot reach a value already stored, and
          the sweep applies whichever is lower. Saying so here is the only way
          an Owner finds out before a transcript they expected is gone. */}
      {effective < days ? (
        <p className="text-warn-text mt-2 text-sm">
          This Org is set to {days} days, and its Tier now allows {ceiling}.{' '}
          {effective} days is the window in force. Save a number at or under the
          ceiling to settle it.
        </p>
      ) : null}

      {/* Retention needs a scheduler this deployment supplies, so an Owner
          reading a window has no way to tell whether anything enforces it. */}
      <p className="text-text-muted mt-2 text-sm">
        {lastSwept === null
          ? 'No retention sweep has run on this deployment yet, so nothing has been removed. Whoever runs it schedules POST /api/retention/sweep.'
          : `Retention last ran ${SWEPT.format(lastSwept)}.`}
      </p>

      {/* The window in force rather than the stored setting, so the field is
          never pre-filled with a number above its own `max` — which a browser
          refuses to submit until it is edited, leaving the form dead exactly
          for the Org whose Tier has shrunk. */}
      <RetentionForm orgId={orgId} current={effective} ceiling={ceiling} />
    </section>
  )
}
