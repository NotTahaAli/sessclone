import { AddRateForm } from './add-rate-form'
import { DeleteRate } from './delete-rate'
import { SyncPricing } from './sync-pricing'
import { TextFilter } from '../text-filter'
import { PageHeader } from '../../(dashboard)/page-header'
import { Row, SectionBreak } from '../../_ui/primitives'
import { asOperator } from '../../../lib/platform-admin'
import { listRates, rateUnit, type Rate } from '../../../lib/rates'
import { unknownModels } from '../../../lib/spend'

// Ticket 63: the published price list, and the models that arrived without
// one.
//
// Both on one page because they are one job. A model appears in the unknown
// list precisely because nothing prices it, and the fix is the form directly
// above — publishing the Rate prices every Turn already waiting, with no
// backfill to run, because `turn_costs` derives the Cost at read time
// (ADR 0002).
//
// The layout gate is `/admin`'s, and the policy gate is `rates_write`. This
// page reads neither as its authority: it is inside the frame that refuses,
// and the statements it issues are refused independently.

// A price is a rate card, not a total: six decimals, because a cache read is
// published at $0.30 per MTok and a rounded one is a different number.
const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 6,
})

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ model?: string }>
}) {
  const { model } = await searchParams
  const filter = model?.trim() ?? ''

  // One transaction, two statements: the page is one read of the deployment's
  // pricing as it stands at one moment. The gate is the layout's; this is the
  // identity the transaction runs as.
  const { rates, more, unknown } = await asOperator(async (tx) => ({
    ...(await listRates(tx, { model: filter || null })),
    unknown: await unknownModels(tx),
  }))

  // Once for the page rather than once per row: two rows read either side of
  // midnight would otherwise disagree about what today is.
  const now = today()

  return (
    <div className="flex max-w-3xl flex-col">
      <PageHeader title="Rates" />
      <p className="text-text-muted mt-3 text-caption">
        What this deployment charges a Turn against. A price change is a new row
        from a date, never an edit: yesterday still costs what it cost.
      </p>

      <section>
        <SectionBreak>Publish a price</SectionBreak>
        <div className="mt-2">
          <AddRateForm
            today={now}
            unknown={unknown.models}
            moreUnknown={unknown.more}
          />
        </div>
      </section>

      <section>
        <SectionBreak>Published pricing</SectionBreak>
        <div className="mt-2">
          <SyncPricing />
        </div>
      </section>

      <section>
        <SectionBreak>Price list</SectionBreak>
        <div className="mt-2">
          <TextFilter
            name="model"
            label="Filter by model"
            value={filter}
            placeholder="opus"
            clearHref="/admin/rates"
          />
        </div>
        {rates.length === 0 ? (
          <p className="text-text-secondary mt-3 text-body">
            {filter
              ? `No price names a model matching “${filter}”.`
              : 'Nothing is priced yet, so every Turn collected so far reads as unpriced rather than as free.'}
          </p>
        ) : (
          <>
            {/* Grouped by model, because that is how an operator reads it:
                one model's classes together, and its superseded rows under
                the price in force. A flat list of every class of every model
                is the same rows in an order nobody asks a question in. */}
            {byModel(rates).map(([name, group]) => (
              <section key={name ?? 'any'} className="mt-5">
                <h3
                  className={`text-caption ${name ? 'font-mono' : 'text-text-muted'}`}
                >
                  {name ?? 'Any model'}
                </h3>
                <ul className="mt-1">
                  {group.map((rate) => (
                    <RateRow key={rate.id} rate={rate} today={now} />
                  ))}
                </ul>
              </section>
            ))}
            {more ? (
              <p className="text-text-muted mt-3 text-caption">
                Only the first 200 rates are shown. Filter by model to reach the
                rest.
              </p>
            ) : null}
          </>
        )}
      </section>
    </div>
  )
}

function RateRow({ rate, today: now }: { rate: Rate; today: string }) {
  const said = `${rate.class.replaceAll('_', ' ')} price for ${
    rate.model ?? 'any model'
  } from ${rate.effectiveFrom}`

  return (
    <li>
      {/* Superseded rather than deleted: it is still what last month cost.
          "Latest" rather than "in force", because which Rate actually prices
          a Turn is `sessclone_resolve_rate`'s answer — a row naming the
          model beats a model-independent one, and an Org's negotiated
          override beats both. */}
      <Row
        lead="none"
        name={rate.class.replaceAll('_', ' ')}
        value={money.format(rate.priceUsd)}
        sub={`${rateUnit(rate.class)} · from ${rate.effectiveFrom} · ${
          rate.current
            ? 'latest for this model and class'
            : rate.effectiveFrom > now
              ? 'scheduled'
              : 'superseded'
        }${rate.source ? ` · ${rate.source}` : ''}`}
      />
      <div className="-mt-1.5 pb-1 pl-[22px]">
        <DeleteRate rateId={rate.id} said={said} />
      </div>
    </li>
  )
}

/**
 * The rates in the order they came back, cut into one group per model.
 *
 * The query already sorts by model, so this is a fold rather than a sort — and
 * it keeps the class-then-date order inside each group.
 */
const byModel = (rates: Rate[]): [string | null, Rate[]][] => {
  const groups: [string | null, Rate[]][] = []
  for (const rate of rates) {
    const last = groups.at(-1)
    if (last && last[0] === rate.model) last[1].push(rate)
    else groups.push([rate.model, [rate]])
  }
  return groups
}

/** The default effective date, as the server's own day. */
const today = () => new Date().toISOString().slice(0, 10)
