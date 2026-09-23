import { notFound } from 'next/navigation'

import { addOwnRateAction, deleteOwnRateAction } from './actions'
import {
  AddOrgRateForm,
  DeleteOrgRate,
} from '../../../../admin/orgs/[orgId]/org-rate-form'
import { PageHeader } from '../../../page-header'
import { asViewer } from '../../../../../lib/db'
import {
  listOrgRates,
  OVERRIDE_PAGE,
  pricedModels,
} from '../../../../../lib/org-rates'
import { rateUnit } from '../../../../../lib/rates'
import { orgTier } from '../../../../../lib/tier'
import { currentViewer, reachesOrgSettings } from '../../../../../lib/viewer'

// Ticket 121: an Enterprise Org's own per-model rates, in rows.
//
// Plain on purpose: the visual layer is ticket 111's, and this reuses the
// admin page's form and row markup rather than inventing a third. Owner or
// Admin, as the rest of Org settings; the form appears only when the Org's
// Tier has `features.own_rates`, and `org_rate_overrides_own` refuses the
// write otherwise whatever this page renders.

const MONEY = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 6,
})

export default async function Page() {
  const viewer = await currentViewer()
  if (!viewer || !reachesOrgSettings(viewer.role)) notFound()

  const now = new Date().toISOString().slice(0, 10)

  const { tier, overrides, models } = await asViewer(
    viewer.userId,
    async (tx) => ({
      tier: await orgTier(tx, viewer.orgId),
      overrides: await listOrgRates(tx, viewer.orgId),
      models: await pricedModels(tx),
    }),
  )
  const writable = tier?.features.own_rates === true

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Rates"
        description="What this Org's costs are estimated at, per model, instead of the published price. sessclone bills per seat, so a rate changes the estimates your Members read and never the invoice."
      />

      {writable ? (
        <AddOrgRateForm
          orgId={viewer.orgId}
          today={now}
          models={models}
          action={addOwnRateAction}
        />
      ) : (
        <p className="text-text-secondary text-body">
          Setting your own per-model rates comes with the Enterprise plan.
        </p>
      )}

      {overrides.rates.length === 0 ? (
        <p className="text-text-secondary text-body">
          This Org is on the published prices.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {overrides.rates.map((rate) => (
            <li
              key={rate.id}
              className="border-rule bg-surface rounded-md border p-3"
            >
              <p className="text-body">
                <span className="font-mono">{rate.model ?? 'any model'}</span> ·{' '}
                {rate.class.replaceAll('_', ' ')}
              </p>
              <p className="text-text-secondary text-caption">
                {MONEY.format(rate.priceUsd)} {rateUnit(rate.class)} from{' '}
                {rate.effectiveFrom}
                {rate.platformUsd === null
                  ? ' · nothing published to compare'
                  : ` · published ${MONEY.format(rate.platformUsd)}`}
                {rate.current
                  ? ''
                  : rate.effectiveFrom > now
                    ? ' · scheduled'
                    : ' · superseded'}
              </p>
              {rate.note ? (
                <p className="text-text-muted text-caption">{rate.note}</p>
              ) : null}
              {writable ? (
                <DeleteOrgRate
                  orgId={viewer.orgId}
                  rateId={rate.id}
                  said={`${rate.model ?? 'any model'} ${rate.class} rate from ${rate.effectiveFrom}`}
                  action={deleteOwnRateAction}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {overrides.more ? (
        <p className="text-text-muted text-caption">
          Only the first {OVERRIDE_PAGE} rates are shown.
        </p>
      ) : null}
    </div>
  )
}
