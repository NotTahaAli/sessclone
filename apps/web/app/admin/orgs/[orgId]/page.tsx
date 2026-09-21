import { notFound } from 'next/navigation'

import { ActivateForm } from './activate-form'
import { AddOrgRateForm, DeleteOrgRate } from './org-rate-form'
import { PageHeader } from '../../../(dashboard)/page-header'
import { asOperator } from '../../../../lib/platform-admin'
import {
  listOrgRates,
  OVERRIDE_PAGE,
  pricedModels,
} from '../../../../lib/org-rates'
import { rateUnit } from '../../../../lib/rates'
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
  const { org, tiers, history, overrides, models } = await asOperator(async (tx) => ({
    org: await adminOrg(tx, orgId),
    tiers: await tierChoices(tx),
    history: await subscriptionHistory(tx, orgId),
    overrides: await listOrgRates(tx, orgId),
    models: await pricedModels(tx),
  }))

  if (!org) notFound()

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <PageHeader
        title={org.name}
        description={`${org.seats} ${org.seats === 1 ? 'seat' : 'seats'} in use · ${
          org.tierName ? `${org.tierName}, ${org.status}` : 'no Tier yet'
        }`}
      />

      <section>
        <h2 className="text-heading">Subscription</h2>
        <p className="text-text-secondary mt-1 text-caption">
          There is no payment rail in v1, so this is the record of a decision
          somebody took. Say why in the note.
        </p>
        <div className="mt-3">
          <ActivateForm
            orgId={org.id}
            tiers={tiers}
            tierId={org.tierId}
            status={org.status}
          />
        </div>
      </section>

      {/* Ticket 64. An Org with negotiated pricing has to see estimates that
          match what it actually pays, and the resolution that makes that true
          lives in `turn_costs` — this page is only the rows. */}
      <section>
        <h2 className="text-heading">Negotiated pricing</h2>
        <p className="text-text-secondary mt-1 text-caption">
          What this Org pays instead of the published price. A change is a new
          row from a date, never an edit, so what last month cost stays what it
          cost. Nothing is backfilled: the Turns reprice on the next read.
        </p>
        <div className="mt-3">
          <AddOrgRateForm orgId={org.id} today={now} models={models} />
        </div>

        {overrides.rates.length === 0 ? (
          <p className="text-text-secondary mt-4 text-body">
            This Org is on list price.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {overrides.rates.map((rate) => (
              <li
                key={rate.id}
                className="border-rule bg-surface rounded-md border p-3"
              >
                <p className="text-body">
                  <span className="font-mono">{rate.model ?? 'any model'}</span>{' '}
                  · {rate.class.replaceAll('_', ' ')}
                </p>
                <p className="text-text-secondary text-caption">
                  {MONEY.format(rate.priceUsd)} {rateUnit(rate.class)} from{' '}
                  {rate.effectiveFrom}
                  {/* The published price beside it: an override reads as a
                      number until you can see what it replaces. */}
                  {rate.platformUsd === null
                    ? ' · nothing published to compare'
                    : ` · list ${MONEY.format(rate.platformUsd)}`}
                  {rate.current
                    ? ''
                    : rate.effectiveFrom > now
                      ? ' · scheduled'
                      : ' · superseded'}
                </p>
                {rate.note ? (
                  <p className="text-text-muted text-caption">{rate.note}</p>
                ) : null}
                <DeleteOrgRate
                  orgId={org.id}
                  rateId={rate.id}
                  said={`${rate.model ?? 'any model'} ${rate.class} price from ${rate.effectiveFrom}`}
                />
              </li>
            ))}
          </ul>
        )}
        {overrides.more ? (
          <p className="text-text-muted mt-2 text-caption">
            Only the first {OVERRIDE_PAGE} negotiated prices are shown.
          </p>
        ) : null}
      </section>

      <section>
        <h2 className="text-heading">History</h2>
        {history.length === 0 ? (
          <p className="text-text-secondary mt-2 text-body">
            Nothing has happened to this subscription yet.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {history.map((event) => (
              <li
                key={event.id}
                className="border-rule bg-surface rounded-md border p-3"
              >
                <p className="text-body">
                  {event.tierName} · {event.status}
                </p>
                <p className="text-text-muted text-caption">
                  {event.occurredAt
                    .toISOString()
                    .slice(0, 16)
                    .replace('T', ' ')}{' '}
                  UTC · {event.actorEmail ?? event.provider}
                </p>
                {event.note ? (
                  <p className="text-text-secondary mt-1 text-caption">
                    {event.note}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {history.length >= HISTORY_PAGE ? (
          <p className="text-text-muted mt-2 text-caption">
            Only the {HISTORY_PAGE} most recent changes are shown.
          </p>
        ) : null}
      </section>
    </div>
  )
}
