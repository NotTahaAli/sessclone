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
// One decimal: whole percentages on five rows visibly sum to 101%, and a
// reader checking the arithmetic on a page about money is the reader this
// page is for.
const share = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 1,
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
  total,
  more = 0,
  moreUnpriced = 0,
}: {
  rows: BreakdownRow[]
  dimension: Dimension
  /**
   * The period's cost across every group, which is the figure in the Cost tile
   * above. The shares are of that rather than of the rows shown, or past the
   * cap a share times the headline total would be the wrong number of dollars.
   */
  total: number | null
  /** Groups the read left out, so the list says so rather than looking whole. */
  more?: number
  /** Of those, how many have nothing priced: they sort last, so they go first. */
  moreUnpriced?: number
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
  // The bar is a share of the largest row shown; the percentage is a share of
  // the period. The two answer different questions and only one of them has to
  // agree with the tile above.
  const peak = Math.max(...rows.map((row) => row.costUsd ?? 0))

  return (
    <ol className="flex flex-col">
      {rows.map((row) => (
        <li
          key={row.id ?? row.label}
          className="border-rule flex flex-col gap-1 border-b py-3"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="font-mono text-sm break-all" title={row.label}>
              {middleTruncate(row.label)}
              {row.note ? (
                <span className="text-text-muted"> — {row.note}</span>
              ) : null}
            </span>
            {/* A row with nothing priced shows a dash, never $0.00: the
                money is not zero, it is unknown, and the caption below says
                how many Turns are waiting on a rate. */}
            <span className="flex items-baseline gap-3 font-mono text-sm">
              <span>
                {row.costUsd === null ? '—' : money.format(row.costUsd)}
              </span>
              <span className="text-text-muted text-caption">
                {row.costUsd !== null && total !== null && total > 0
                  ? share.format(row.costUsd / total)
                  : '—'}
              </span>
            </span>
          </div>

          {/* The bar itself. A `div` at a percentage width, not an SVG: one
              rectangle per row does not need a coordinate system. */}
          <div className="bg-surface-hover h-2 w-full rounded-sm">
            <Bar fraction={peak > 0 ? (row.costUsd ?? 0) / peak : 0} />
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
      {more > 0 ? (
        <li className="text-text-muted py-3 text-caption">
          {whole.format(more)} more, below the {whole.format(rows.length)}{' '}
          largest
          {moreUnpriced > 0
            ? `, ${whole.format(moreUnpriced)} of them with nothing priced`
            : ''}
          . The totals above count all of them.
        </li>
      ) : null}
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
  // A floor of one step so a small row is still visible, but only for a row
  // that spent something: nothing priced, or nothing spent, draws no bar
  // rather than a sliver that reads as a small amount.
  const step = fraction > 0 ? Math.max(1, Math.round(fraction * 20)) : 0
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
