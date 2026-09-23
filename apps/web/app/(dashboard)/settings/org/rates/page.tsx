import { notFound } from 'next/navigation'

import { addOwnRateAction, deleteOwnRateAction } from './actions'
import {
  AddOrgRateForm,
  DeleteOrgRate,
} from '../../../../admin/orgs/[orgId]/org-rate-form'
import { PageHeader } from '../../../page-header'
import { Row, SectionBreak } from '../../../../_ui/primitives'
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
// Direction A rows (ticket 111), and the admin page's form rather than a
// second one. Owner or
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
    <div className="flex max-w-3xl flex-col">
      <PageHeader title="Rates" back="/settings" />
      <p className="text-text-muted mt-3 text-caption">
        What this Org&apos;s costs are estimated at, per model, instead of the
        published price. SessClone bills per seat, so a rate changes the
        estimates your Members read and never the invoice.
      </p>

      <SectionBreak>Set a rate</SectionBreak>
      {writable ? (
        <AddOrgRateForm
          orgId={viewer.orgId}
          today={now}
          models={models}
          action={addOwnRateAction}
        />
      ) : (
        <p className="text-text-muted py-1 text-body">
          Setting your own per-model rates comes with the Enterprise plan.
        </p>
      )}

      <SectionBreak>
        {overrides.rates.length === 0
          ? 'Published prices'
          : `Your rates · ${overrides.rates.length}`}
      </SectionBreak>
      {overrides.rates.length === 0 ? (
        <p className="text-text-muted py-1 text-body">
          This Org is on the published prices.
        </p>
      ) : (
        <ol className="mt-1">
          {overrides.rates.map((rate) => (
            <li key={rate.id} className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <Row
                  lead={rate.current ? 'ok' : 'idle'}
                  value={`${MONEY.format(rate.priceUsd)} ${rateUnit(rate.class)}`}
                  sub={[
                    `from ${rate.effectiveFrom}`,
                    rate.platformUsd === null
                      ? 'nothing published to compare'
                      : `published ${MONEY.format(rate.platformUsd)}`,
                    rate.current
                      ? null
                      : rate.effectiveFrom > now
                        ? 'scheduled'
                        : 'superseded',
                    rate.note,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                >
                  <span className="font-mono">{rate.model ?? 'any model'}</span>{' '}
                  <span className="text-text-muted">
                    {rate.class.replaceAll('_', ' ')}
                  </span>
                </Row>
              </div>
              {writable ? (
                <div className="pt-1.5">
                  <DeleteOrgRate
                    orgId={viewer.orgId}
                    rateId={rate.id}
                    said={`${rate.model ?? 'any model'} ${rate.class} rate from ${rate.effectiveFrom}`}
                    action={deleteOwnRateAction}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      {overrides.more ? (
        <p className="text-text-muted mt-1 text-caption">
          Only the first {OVERRIDE_PAGE} rates are shown.
        </p>
      ) : null}
    </div>
  )
}
