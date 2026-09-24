import Link from 'next/link'
import { notFound } from 'next/navigation'

import { ActivateForm } from './activate-form'
import { setOperatorName } from './actions'
import { InlineName } from '../../../(dashboard)/inline-name'
import { AddOrgRateForm, DeleteOrgRate } from './org-rate-form'
import { PageHeader } from '../../../(dashboard)/page-header'
import { Field, Row, SectionBreak } from '../../../_ui/primitives'
import { asOperator } from '../../../../lib/platform-admin'
import {
  listOrgRates,
  OVERRIDE_PAGE,
  pricedModels,
} from '../../../../lib/org-rates'
import { rateUnit } from '../../../../lib/rates'
import { agreedPrice } from '../../../../lib/tier'
import { tierChoices } from '../../../../lib/tier-admin'
import {
  adminOrg,
  HISTORY_PAGE,
  subscriptionHistory,
} from '../../../../lib/subscriptions'

// Tickets 48 and 65: one Org's subscription, and everything that has happened
// to it.
//
// The form and the history are on one page because they are one thing. An
// activation with no payment rail behind it is somebody's decision, and the
// only thing that makes that safe to live with is that the decision is written
// down next to the control that takes it.
//
// The event is not written here and cannot be skipped here: it is a trigger on
// `subscriptions` (ticket 47's schema), so a row written by this form, by a
// provider's webhook in v2, or by hand in psql all leave the same trail.

const MONEY = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 6,
})

export default async function Page({
  params,
}: {
  params: Promise<{ orgId: string }>
}) {
  const { orgId } = await params

  // Once for the page rather than once per control: two reads either side of
  // midnight would otherwise disagree about what today is.
  const now = new Date().toISOString().slice(0, 10)

  // One transaction: the Org, the Tiers it could be put on, and what has
  // happened to it. `orgs_read` is what decides the first of them comes back
  // at all, so an Org this caller may not read is a 404 rather than a refusal.
  const { org, tiers, history, overrides, models } = await asOperator(
    async (tx) => ({
      org: await adminOrg(tx, orgId),
      tiers: await tierChoices(tx),
      history: await subscriptionHistory(tx, orgId),
      overrides: await listOrgRates(tx, orgId),
      models: await pricedModels(tx),
    }),
  )

  if (!org) notFound()

  const agreed = agreedPrice(org)

  return (
    <div className="flex max-w-3xl flex-col">
      <PageHeader title={org.operatorName ?? org.name} />
      <p className="text-text-muted mt-2 text-caption">
        <Link href="/admin/orgs" className="hover:text-text">
          ‹ All Orgs
        </Link>
      </p>

      {/* What the Org is, as settings lines (Direction A's Field). */}
      <SectionBreak>Org</SectionBreak>
      {/* Ticket 102. Its own table and policy, so the Org never reads it. */}
      <Field
        label="Admin name"
        hint="What platform administrators call this Org. Its own people never see it. Save an empty box to go back to the Org's own name."
      >
        <InlineName
          action={setOperatorName}
          hidden={`orgId=${org.id}`}
          current={org.operatorName}
          fallback={org.name}
          label="Admin name for this Org"
          placeholder="Acme, pilot"
        />
      </Field>
      {org.operatorName ? <Field label="Calls itself">{org.name}</Field> : null}
      <Field label="Seats in use">{String(org.seats)}</Field>
      <Field label="Tier">
        {org.tierName ? `${org.tierName}, ${org.status}` : 'no Tier yet'}
      </Field>
      <Field label="Agreed price">{agreed ?? 'the Tier’s own'}</Field>

      <SectionBreak>Subscription</SectionBreak>
      <p className="text-text-muted mb-3 text-caption">
        There is no payment rail in v1, so this is the record of a decision
        somebody took. Say why in the note.
      </p>
      <ActivateForm
        orgId={org.id}
        tiers={tiers}
        tierId={org.tierId}
        status={org.status}
        priceBaseCents={org.priceBaseCents}
        priceSeatCents={org.priceSeatCents}
      />

      {/* Ticket 64. An Org with negotiated pricing has to see estimates that
          match what it actually pays, and the resolution that makes that true
          lives in `turn_costs` — this page is only the rows. */}
      <SectionBreak>Negotiated pricing</SectionBreak>
      <p className="text-text-muted mb-3 text-caption">
        What this Org pays instead of the published price. A change is a new row
        from a date, never an edit, so what last month cost stays what it cost.
        Nothing is backfilled: the Turns reprice on the next read.
      </p>
      <AddOrgRateForm orgId={org.id} today={now} models={models} />

      {overrides.rates.length === 0 ? (
        <p className="text-text-muted py-3 text-body">
          This Org is on list price.
        </p>
      ) : (
        <ol className="mt-2">
          {overrides.rates.map((rate) => (
            <li key={rate.id}>
              {/* The published price beside it: an override reads as a
                  number until you can see what it replaces. */}
              <Row
                lead="none"
                value={MONEY.format(rate.priceUsd)}
                sub={`${rateUnit(rate.class)} from ${rate.effectiveFrom}${
                  rate.platformUsd === null
                    ? ' · nothing published to compare'
                    : ` · list ${MONEY.format(rate.platformUsd)}`
                }${
                  rate.current
                    ? ''
                    : rate.effectiveFrom > now
                      ? ' · scheduled'
                      : ' · superseded'
                }${rate.note ? ` · ${rate.note}` : ''}`}
              >
                <span className="font-mono">{rate.model ?? 'any model'}</span> ·{' '}
                {rate.class.replaceAll('_', ' ')}
              </Row>
              <div className="-mt-1.5 pb-1 pl-[22px]">
                <DeleteOrgRate
                  orgId={org.id}
                  rateId={rate.id}
                  said={`${rate.model ?? 'any model'} ${rate.class} price from ${rate.effectiveFrom}`}
                />
              </div>
            </li>
          ))}
        </ol>
      )}
      {overrides.more ? (
        <p className="text-text-muted mt-2 text-caption">
          Only the first {OVERRIDE_PAGE} negotiated prices are shown.
        </p>
      ) : null}

      <SectionBreak>History</SectionBreak>
      {history.length === 0 ? (
        <p className="text-text-muted py-3 text-body">
          Nothing has happened to this subscription yet.
        </p>
      ) : (
        <ol>
          {history.map((event) => (
            <li key={event.id}>
              <Row
                lead="none"
                name={`${event.tierName} · ${event.status} · ${
                  agreedPrice(event) ?? 'Tier price'
                }`}
                meta={`${event.occurredAt
                  .toISOString()
                  .slice(0, 16)
                  .replace('T', ' ')} UTC`}
                sub={`${event.actorName ?? event.provider}${
                  event.note ? ` · ${event.note}` : ''
                }`}
              />
            </li>
          ))}
        </ol>
      )}
      {history.length >= HISTORY_PAGE ? (
        <p className="text-text-muted mt-2 text-caption">
          Only the {HISTORY_PAGE} most recent changes are shown.
        </p>
      ) : null}
    </div>
  )
}
