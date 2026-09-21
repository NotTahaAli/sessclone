import { deleteRateAction } from './actions'
import { AddRateForm } from './add-rate-form'
import { PageHeader } from '../../(dashboard)/page-header'
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

export default async function Page() {
  // One transaction, two statements: the page is one read of the deployment's
  // pricing as it stands at one moment. The gate is the layout's; this is the
  // identity the transaction runs as.
  const { rates, more, unknown } = await asOperator(async (tx) => ({
    ...(await listRates(tx)),
    unknown: await unknownModels(tx),
  }))

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <PageHeader
        title="Rates"
        description="What this deployment charges a Turn against. A price change is a new row from a date, never an edit: yesterday still costs what it cost."
      />

      <section>
        <h2 className="text-heading">Publish a price</h2>
        <div className="mt-3">
          <AddRateForm today={today()} unknown={unknown} />
        </div>
      </section>

      <section>
        <h2 className="text-heading">Price list</h2>
        {rates.length === 0 ? (
          <p className="text-text-secondary mt-2 text-body">
            Nothing is priced yet, so every Turn collected so far reads as
            unpriced rather than as free.
          </p>
        ) : (
          <>
            {/* Grouped by model, because that is how an operator reads it:
                one model's classes together, and its superseded rows under
                the price in force. A flat list of every class of every model
                is the same rows in an order nobody asks a question in. */}
            {byModel(rates).map(([model, group]) => (
              <section key={model ?? 'any'} className="mt-5">
                <h3 className="font-mono text-body">{model ?? 'any model'}</h3>
                <ul className="mt-2 flex flex-col gap-2">
                  {group.map((rate) => (
                    <RateRow key={rate.id} rate={rate} />
                  ))}
                </ul>
              </section>
            ))}
            {more ? (
              <p className="text-text-muted mt-3 text-caption">
                Only the first 200 rates are shown.
              </p>
            ) : null}
          </>
        )}
      </section>
    </div>
  )
}

function RateRow({ rate }: { rate: Rate }) {
  return (
    <li className="border-rule bg-surface flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-md border p-3">
      <div>
        <p className="text-body">{rate.class.replaceAll('_', ' ')}</p>
        <p className="text-text-muted text-caption">
          from {rate.effectiveFrom}
          {rate.source ? ` · ${rate.source}` : ''}
        </p>
      </div>
      <div className="text-left sm:text-right">
        <p className="text-body">
          {money.format(rate.priceUsd)}{' '}
          <span className="text-text-muted text-caption">
            {rateUnit(rate.class)}
          </span>
        </p>
        {/* Superseded rather than deleted: it is still what last month cost,
            and the page says which row today resolves to so an operator can
            see at a glance that a correction actually took effect. */}
        <p className="text-text-muted text-caption">
          {rate.current
            ? 'in force today'
            : rate.effectiveFrom > today()
              ? 'scheduled'
              : 'superseded'}
        </p>
        {/* The only correction there is: a Rate is never edited, so a price
            published by mistake is removed and every Turn that resolved to it
            reprices on the next read. */}
        <form action={deleteRateAction} className="mt-1">
          <input type="hidden" name="rateId" value={rate.id} />
          <button
            type="submit"
            className="text-text-muted text-caption underline"
          >
            Delete
            <span className="sr-only">
              {' '}
              the {rate.class} price for {rate.model ?? 'any model'} from{' '}
              {rate.effectiveFrom}
            </span>
          </button>
        </form>
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
