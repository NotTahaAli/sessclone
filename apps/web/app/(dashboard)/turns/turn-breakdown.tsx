import type { Quantity, TurnDetail } from '../../../lib/turns'
import { count, usd } from '../../../lib/money'

// Ticket 88's second level: every quantity a Turn recorded, named, with what
// it cost. The component rather than the page, because ticket 86's Session
// detail links into the same surface and neither should grow its own.
//
// The rule the whole thing hangs on is ADR 0002's, and it is the one ticket 42
// had to fix once already: a quantity with no Rate is *unpriced*, never zero.
// A zero understates while looking authoritative, and this table is precisely
// where a reader goes to find out why a total looked small.

const UNIT: Record<Quantity['unit'], string> = {
  per_mtok: 'per MTok',
  per_krequests: 'per 1,000',
}

export function TurnBreakdown({ detail }: { detail: TurnDetail }) {
  const { quantities } = detail

  return (
    <section
      aria-labelledby="breakdown"
      className="border-rule bg-surface rounded-md border"
    >
      <h2 id="breakdown" className="sr-only">
        What this Turn consumed
      </h2>

      {/* A list of rows rather than a `table`: at 390px a four-column table
          scrolls sideways, and the phone is where this is read. Each row is
          the quantity, then the rate, then the cost — stacked under 640px and
          in line above it. */}
      <ul>
        {quantities.map((quantity) => (
          <li
            key={quantity.key}
            className="border-rule flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b p-4 last:border-b-0"
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-body">{quantity.label}</span>
              <span className="text-text-muted text-caption">
                {count.format(quantity.quantity)}
                {quantity.unit === 'per_mtok' ? ' tokens' : ' requests'}
                {quantity.rateUsd === null
                  ? ''
                  : ` · ${usd(quantity.rateUsd)} ${UNIT[quantity.unit]}`}
                {quantity.note ? ` · ${quantity.note}` : ''}
              </span>
            </span>

            {quantity.unpriced ? (
              // Said in words rather than as a dash alone: a dash in a money
              // column is ambiguous, and the one reading a breakdown is the
              // reader who needs to know the difference between "nothing" and
              // "nobody knows".
              <span className="text-warn-text font-mono text-body">
                unpriced
              </span>
            ) : (
              <span
                className={`font-mono text-body ${
                  quantity.quantity === 0 ? 'text-text-muted' : ''
                }`}
              >
                {usd(quantity.costUsd)}
              </span>
            )}
          </li>
        ))}
      </ul>

      <Total detail={detail} />
    </section>
  )
}

/**
 * The Turn's own total, from `turn_costs` rather than from the rows above.
 *
 * Deliberately the view's figure and not a sum of this table: the view is what
 * every other surface in the product adds up, so a page that summed its own
 * rows could disagree with the Costs total by a rounding step and leave the
 * reader unable to tell which is the product's answer. `test/turns.test.ts`
 * proves the two agree; if they ever stop, that test is the place it surfaces.
 */
function Total({ detail }: { detail: TurnDetail }) {
  const { row, facts } = detail

  return (
    <div className="border-rule bg-ground flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t p-4">
      <span className="flex flex-col gap-0.5">
        <span className="text-body">Estimated cost</span>
        <span className="text-text-muted text-caption">
          priced on {facts.pricedOn}
          {facts.multiplier === 1
            ? ''
            : ` · ×${facts.multiplier} for the modifiers this Turn carries`}
        </span>
      </span>
      <span className="flex flex-col items-end gap-0.5 text-right">
        <span className="font-mono text-figure">{usd(row.costUsd)}</span>
        {/* Claude Code's own figure, shown beside ours rather than instead of
            it. They are two different claims — ours is published prices times
            reported usage — and a reader comparing them is the point. */}
        {facts.reportedCostUsd === null ? null : (
          <span className="text-text-muted text-caption">
            Claude Code reported {usd(facts.reportedCostUsd)}
          </span>
        )}
      </span>
    </div>
  )
}

/**
 * The dimensions the Turn recorded — the ones that change a price, and the
 * ones that only explain it.
 *
 * Every one of them is nullable in the schema: a transcript may state none of
 * them. An absent one says "not reported" rather than being dropped, because
 * "we have no value" and "the value is none" are different answers and this is
 * the page a person opens to find out which.
 */
export function TurnFacts({ detail }: { detail: TurnDetail }) {
  const { row, facts } = detail

  const entries: [string, string | null][] = [
    ['Model', row.model],
    ['Service tier', facts.serviceTier],
    ['Speed', facts.speed],
    ['Inference geography', facts.inferenceGeo],
    ['Client version', facts.clientVersion],
    [
      'Spawn depth',
      facts.spawnDepth === null ? null : String(facts.spawnDepth),
    ],
    ['Cloud session', facts.cloudSessionHandle],
    ['Complete', row.complete ? 'yes' : 'no — these counters are a floor'],
  ]

  return (
    <dl className="border-rule bg-surface grid grid-cols-1 gap-x-6 gap-y-3 rounded-md border p-4 sm:grid-cols-2">
      {entries.map(([label, value]) => (
        <div key={label} className="flex flex-col gap-0.5">
          <dt className="text-label text-text-muted uppercase">{label}</dt>
          <dd
            className={
              value === null
                ? 'text-text-muted text-body'
                : 'font-mono text-body break-all'
            }
          >
            {value ?? 'not reported'}
          </dd>
        </div>
      ))}
    </dl>
  )
}
