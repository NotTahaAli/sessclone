import { Row } from '../../_ui/primitives'
import { hrefWith, type Query } from '../query'
import type { BreakdownRow, Dimension } from '../../../lib/breakdown'
import { compact, count, usd } from '../../../lib/money'

// The ranked list that tickets 54, 55 and 56 each show, as Direction A's rows
// (ticket 112): the name, the cost as the right-aligned mono figure, a meter
// under the name, and tokens, turns and the share on the line below.
//
// `docs/design/dashboard-wireframes.md` picked the shape and said why — a pie
// cannot be read past four slices and cannot be sorted — and it is one
// component for the three views because the question is the same one asked of
// a different column. The meter carries the ranking; the share is a number,
// because a bar read off a screenshot is not a figure anybody can quote.
//
// A row opens its Turns: in a column beside the list on desktop, in the
// list's place on a phone (`finder.tsx`). The row that is open is the one
// filled row on the page.

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
  params,
  open,
  more = 0,
  moreUnpriced = 0,
}: {
  rows: BreakdownRow[]
  dimension: Dimension
  /** The current query, so a row's link keeps the period it was ranked for. */
  params: Query
  /** The id of the row whose column is open, `none` for the unnamed group. */
  open?: string
  /**
   * The period's cost across every group, which is the Spent figure above.
   * The shares are of that rather than of the rows shown, or past the cap a
   * share times the headline total would be the wrong number of dollars.
   */
  total: number | null
  /** Groups the read left out, so the list says so rather than looking whole. */
  more?: number
  /** Of those, how many have nothing priced: they sort last, so they go first. */
  moreUnpriced?: number
}) {
  if (rows.length === 0) {
    return <p className="text-text-muted py-3 text-body">{EMPTY[dimension]}</p>
  }

  // The meter is a share of the largest row shown; the percentage is a share
  // of the period. The two answer different questions and only one of them
  // has to agree with the figure above.
  const peak = Math.max(...rows.map((row) => row.costUsd ?? 0))

  return (
    <ol className="flex flex-col">
      {rows.map((row) => {
        // The catch-all on People is the one row with no id — its Turns
        // belong to Members outside the viewer's view — so it opens nothing.
        const openable = row.id !== null || dimension !== 'members'
        const key = row.id ?? 'none'
        return (
          <li key={key}>
            <Row
              lead={openable ? undefined : 'none'}
              href={
                openable
                  ? hrefWith('/costs', params, { view: dimension, open: key })
                  : undefined
              }
              selected={openable && open === key}
              // A dash, never $0.00, for a row with nothing priced: the money
              // is not zero, it is unknown.
              value={usd(row.costUsd)}
              meter={peak > 0 ? (row.costUsd ?? 0) / peak : 0}
              sub={
                <>
                  {compact.format(row.tokens)} tokens ·{' '}
                  {count.format(row.turns)} {row.turns === 1 ? 'turn' : 'turns'}
                  {row.unpricedTurns > 0
                    ? ` · ${count.format(row.unpricedTurns)} unpriced`
                    : ''}
                  {row.costUsd !== null && total !== null && total > 0
                    ? ` · ${share.format(row.costUsd / total)}`
                    : ''}
                </>
              }
            >
              <span
                title={row.label}
                className={dimension === 'members' ? '' : 'font-mono'}
              >
                {middleTruncate(row.label)}
                {row.note ? (
                  <span className="text-text-muted"> — {row.note}</span>
                ) : null}
              </span>
            </Row>
          </li>
        )
      })}
      {more > 0 ? (
        <li className="text-text-muted py-3 text-caption">
          {count.format(more)} more, below the {count.format(rows.length)}{' '}
          largest
          {moreUnpriced > 0
            ? `, ${count.format(moreUnpriced)} of them with nothing priced`
            : ''}
          . The totals above count all of them.
        </li>
      ) : null}
    </ol>
  )
}
