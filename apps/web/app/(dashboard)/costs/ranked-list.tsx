import type { BreakdownRow, Dimension } from '../../../lib/breakdown'

// The ranked list that tickets 54, 55 and 56 each show: horizontal bars,
// sorted, with the share as a number beside them.
//
// `docs/design/dashboard-wireframes.md` picked the shape and said why — a pie
// cannot be read past four slices and cannot be sorted — and it is one
// component for the three views because the question is the same one asked of
// a different column. The bar carries the ranking; the number carries the
// share, because a bar read off a screenshot is not a figure anybody can quote.

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
})
const tokens = new Intl.NumberFormat('en-US', { notation: 'compact' })
const whole = new Intl.NumberFormat('en-US')
const share = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 0,
})

/**
 * A long name, shortened from the middle.
 *
 * Repository keys collide at the head — `github.com/acme/…` for every one of
 * them — and the tail is what tells them apart, so the usual ellipsis at the
 * end removes the only part worth reading.
 */
const middleTruncate = (label: string, limit = 44) =>
  label.length <= limit
    ? label
    : `${label.slice(0, Math.ceil(limit / 2) - 1)}…${label.slice(-Math.floor(limit / 2))}`

const EMPTY: Record<Dimension, string> = {
  members: 'Nobody you can see reported a Turn in this period.',
  projects: 'No Project reported a Turn in this period.',
  devices: 'No Device reported a Turn in this period.',
}

export function RankedList({
  rows,
  dimension,
}: {
  rows: BreakdownRow[]
  dimension: Dimension
}) {
  if (rows.length === 0) {
    return (
      <p className="border-rule text-text-muted rounded border border-dashed p-6 text-sm">
        {EMPTY[dimension]}
      </p>
    )
  }

  // The bar is a share of the largest row rather than of the total: at twenty
  // rows every bar would otherwise be a sliver, and the comparison the reader
  // is making is with the row above.
  const peak = Math.max(...rows.map((row) => row.costUsd))
  const total = rows.reduce((sum, row) => sum + row.costUsd, 0)

  return (
    <ol className="flex flex-col">
      {rows.map((row) => (
        <li
          key={row.id ?? row.label}
          className="border-rule flex flex-col gap-1 border-b py-3"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="font-mono text-sm break-all">
              {middleTruncate(row.label)}
              {row.note ? (
                <span className="text-text-muted"> — {row.note}</span>
              ) : null}
            </span>
            <span className="flex items-baseline gap-3 font-mono text-sm">
              <span>{money.format(row.costUsd)}</span>
              <span className="text-text-muted text-caption">
                {total > 0 ? share.format(row.costUsd / total) : '—'}
              </span>
            </span>
          </div>

          {/* The bar itself. A `div` at a percentage width, not an SVG: one
              rectangle per row does not need a coordinate system. */}
          <div className="bg-surface-hover h-2 w-full rounded-sm">
            <Bar fraction={peak > 0 ? row.costUsd / peak : 0} />
          </div>

          <p className="text-text-muted text-caption">
            {tokens.format(row.tokens)} tokens · {whole.format(row.turns)}{' '}
            {row.turns === 1 ? 'turn' : 'turns'}
            {row.unpricedTurns > 0
              ? ` · ${whole.format(row.unpricedTurns)} unpriced`
              : ''}
          </p>
        </li>
      ))}
    </ol>
  )
}

/**
 * One bar, drawn at a twentieth of its width at a time.
 *
 * A width computed per row would be an inline style object, which this repo's
 * lint rule refuses for a good reason — a new object every render. Rounding to
 * a step lets the class be one of a fixed set the stylesheet already contains,
 * and at 5% steps nobody can see the difference on a 200px bar.
 */
function Bar({ fraction }: { fraction: number }) {
  const step = Math.max(1, Math.round(fraction * 20))
  return (
    <div
      className="bg-accent-fill h-2 rounded-sm"
      data-width={step}
      style={WIDTHS[step]}
    />
  )
}

/** Twenty-one widths, built once at module load rather than per render. */
const WIDTHS: Record<number, { width: string }> = Object.fromEntries(
  Array.from({ length: 21 }, (_, step) => [step, { width: `${step * 5}%` }]),
)
