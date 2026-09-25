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
import { Field, SectionBreak } from '../../../_ui/primitives'
import { viewerAppearance } from '../../../../lib/appearance'
import {
  MAX_LOGO_BYTES,
  MIN_LOGO_PIXELS,
  orgLogoSrc,
} from '../../../../lib/org-logo'
import { asViewer } from '../../../../lib/db'
import { listTimezones, orgRetention } from '../../../../lib/org'
import { currentViewer, reachesOrgSettings } from '../../../../lib/viewer'

// Org settings is tickets 51 (timezone), 61 (retention), 77 (appearance
// defaults and the logo) and 101 (the name). Reachable by an Owner or an
// Admin, which is settled in the product IA.
//
// Members and Tier are destinations of their own, listed in the settings
// index column beside this page (ticket 113) rather than as links at its foot.
// Tier is absent from an Admin's index rather than present and refused, and
// `settings/tier/page.tsx` guards the URL.
//
// The nav hides this from a Manager and a Member, and hiding a link is not a
// check — the URL is typeable. ADR 0001 means the *data* is safe either way,
// because every read here is policy-scoped, but the surface is not.
//
// Ticket 113 draws every setting as a row: label left, value right, edited in
// place — a pencil for a name or a number, a select that saves on choosing, a
// switch that saves on flipping, a swatch that saves on pressing.

/** A date a person reads, for "retention last ran". */
const SWEPT = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
})

export default async function Page() {
  const viewer = await currentViewer()
  if (!viewer || !reachesOrgSettings(viewer.role)) notFound()

  const [zones, retention, appearance, logo] = await asViewer(
    viewer.userId,
    (tx) =>
      Promise.all([
        listTimezones(tx),
        orgRetention(tx, viewer.orgId),
        viewerAppearance(tx, viewer.memberId),
        orgLogoSrc(tx, viewer.orgId),
      ]),
  )

  return (
    <div className="flex max-w-3xl flex-col">
      <PageHeader title="Org settings" back="/settings" />

      <SectionBreak>Org</SectionBreak>
      {/* Ticket 101. A pencil, as every other name is: one short string. */}
      <Field
        label="Name"
        hint="What everybody in this Org sees in the navigation and in the invitations you send."
      >
        <InlineName
          action={setOrgName}
          hidden={`orgId=${viewer.orgId}`}
          current={viewer.orgName}
          fallback={viewer.orgName}
          label="The Org’s name"
          placeholder="Acme"
        />
      </Field>
      <Field
        label="Logo"
        hint={
          logo
            ? `Beside ${viewer.orgName} in the navigation, on sign-in from an invitation, and in invitation emails.`
            : `No logo, so the navigation shows the name alone. PNG, JPEG or WebP, at least ${MIN_LOGO_PIXELS}px on each side and under ${Math.round(MAX_LOGO_BYTES / 1024)} kB.`
        }
      >
        <LogoForm orgId={viewer.orgId} orgName={viewer.orgName} src={logo} />
      </Field>
      {/* Said in terms of what it changes: it moves the day boundaries on
          every chart, for everybody. And plainly, because it is about money:
          a Rate is effective from a date, so the day a Turn falls on is also
          the day it is priced on — moving the boundary can move a past total
          by a cent or by a Rate revision. `turn_costs` reads this column,
          which is what makes the two answers agree. */}
      <Field
        label="Timezone"
        hint={`Where ${viewer.orgName}'s days start and end: every chart cuts Turns into days here. Nothing collected is altered, but a Turn is priced at the Rate live on the Org's day, so a past total can change when the boundary moves.`}
      >
        <TimezoneForm
          orgId={viewer.orgId}
          current={viewer.orgTimezone}
          zones={zones}
        />
      </Field>

      <SectionBreak>Accent</SectionBreak>
      {/* One colour decides the accent: the few marks that mean "now" and the
          logo's stroke. The ground, the text, the status colours and the
          chart palette are fixed, so this recolours the product without
          recolouring what it means. */}
      <Field
        label="Default accent"
        hint="What every Member sees until they pick their own. The last swatch takes any colour."
      >
        <SeedPicker
          action={setOrgSeed}
          field="orgId"
          rowId={viewer.orgId}
          current={appearance.orgSeed}
          orgSeed={appearance.orgSeed}
          label="The Org’s accent colour"
        />
      </Field>
      <Field
        label="Members choose their own"
        hint={
          appearance.locked
            ? 'Off: everybody sees the Org’s colour. Light or dark is still theirs, and a Member’s own colour is kept for when this is on again.'
            : 'On: the Org’s colour is what somebody gets until they pick one.'
        }
      >
        <LockForm orgId={viewer.orgId} locked={appearance.locked} />
      </Field>
      {/* The Org's own colour, not the viewer's: an Owner who chose a
          different seed for themselves is still editing the Org's here. */}
      <AccentPreview seed={appearance.orgSeed} tones={appearance.orgTones} />

      {retention ? (
        <>
          <SectionBreak>Retention</SectionBreak>
          <Retention
            orgId={viewer.orgId}
            days={retention.days}
            effective={retention.effective}
            ceiling={retention.ceiling}
            lastSwept={retention.lastSwept}
          />
        </>
      ) : null}
    </div>
  )
}

/**
 * Ticket 61. How long the Org keeps what it holds is the Org's, beside the
 * timezone, where turning archival off is a Member's own (ADR 0005). The
 * window and the Tier's ceiling are both stated, because a control that
 * silently refuses a number is worse than one that says what the bound is.
 */
function Retention({
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
    <>
      {/* The window in force rather than the stored setting, so the field is
          never pre-filled with a number above its own `max` — which a
          browser refuses to submit, leaving the form dead exactly for the Org
          whose Tier has shrunk. */}
      <Field
        label="Keep transcripts"
        hint={`Past this a stored transcript and its record are removed together. Usage and cost never are, so shortening this loses reading material and never money. ${
          ceiling === null
            ? 'This Tier sets no ceiling.'
            : `This Tier allows up to ${ceiling} days.`
        }`}
      >
        <RetentionForm orgId={orgId} current={effective} ceiling={ceiling} />
      </Field>
      {/* The setting and the window in force part company when a Tier
          shrinks under an Org: the trigger cannot reach a stored value, and
          the sweep applies whichever is lower. Saying so is the only way an
          Owner finds out before a transcript they expected is gone. */}
      {effective < days ? (
        <p className="text-warn-text py-1 text-caption">
          This Org is set to {days} days, and its Tier now allows {ceiling}.{' '}
          {effective} days is the window in force. Save a number at or under the
          ceiling to settle it.
        </p>
      ) : null}
      {/* Retention needs a scheduler this deployment supplies, so an Owner
          reading a window has no way to tell whether anything enforces it. */}
      <Field label="Last sweep">
        {lastSwept === null ? 'never' : SWEPT.format(lastSwept)}
      </Field>
      {lastSwept === null ? (
        <p className="text-text-muted py-1 text-caption">
          No retention sweep has run on this deployment yet, so nothing has been
          removed. Whoever runs it schedules POST /api/retention/sweep.
        </p>
      ) : null}
    </>
  )
}
