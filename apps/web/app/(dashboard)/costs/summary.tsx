import type { ReactNode } from 'react'

import type { Day } from '../../../lib/series'
import { compact, count, usd } from '../../../lib/money'

// Ticket 112: the top of every Costs view, as the approved design draws it —
// a small "Spent" label, the figure large in mono, and the three figures that
// say what it is made of on one muted line. The four tiles it replaces said the
// same four things in four boxes.
//
// A period with nothing priced is unknown, not free, so the figure is a dash
// and the line says so; with any unpriced Turn the figure is a floor, and the
// unpriced count sits on the line rather than in a footnote (ADR 0002).

export function Summary({
  costUsd,
  tokens,
  turns,
  unpricedTurns,
  label = 'Spent',
  children,
}: {
  costUsd: number | null
  tokens: number
  turns: number
  unpricedTurns: number
  label?: string
  /** The sparkline, beside the figure on desktop and under it on a phone. */
  children?: ReactNode
}) {
  return (
    <div className="grid gap-x-7 gap-y-3 pt-4 pb-1 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-end">
      <div>
        <p className="text-text-muted text-label uppercase">{label}</p>
        <p className="font-mono text-figure-xl tabular-nums">{usd(costUsd)}</p>
        <p className="text-text-muted mt-1.5 flex flex-wrap gap-x-5 text-[13px]">
          <span>
            <b className="text-text font-mono font-medium">
              {compact.format(tokens)}
            </b>{' '}
            tokens
          </span>
          <span>
            <b className="text-text font-mono font-medium">
              {count.format(turns)}
            </b>{' '}
            {turns === 1 ? 'turn' : 'turns'}
          </span>
          <span>
            <b className="text-text font-mono font-medium">
              {count.format(unpricedTurns)}
            </b>{' '}
            unpriced
          </span>
        </p>
        {costUsd === null ? (
          <p className="text-text-muted mt-1 text-caption">
            Nothing priced yet, so the total is unknown rather than zero.
          </p>
        ) : unpricedTurns > 0 ? (
          <p className="text-text-muted mt-1 text-caption">
            Priced Turns only: the unpriced ones are real usage at a cost not
            yet known.
          </p>
        ) : null}
      </div>
      {children}
    </div>
  )
}

const shortDate = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})

/** `2026-09-04` as `4 Sep`. */
export const dayName = (date: string) =>
  shortDate.format(new Date(`${date}T00:00:00Z`))

/**
 * One bar a day, in the meter ink, and today's in the accent — the one bar on
 * the page that is "now". A server-drawn SVG of rectangles: the numbers are
 * in the By day rows below it, which is also what a screen reader reads.
 */
export function Sparkline({ days, today }: { days: Day[]; today: string }) {
  const peak = Math.max(...days.map((day) => day.costUsd), 0)
  const step = 100 / days.length
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 64"
      preserveAspectRatio="none"
      className="block h-12 w-full lg:h-16"
    >
      {days.map((day, index) => {
        // A floor of a hairline for a day with Turns, so a small day still
        // shows; a day with nothing draws nothing.
        const height =
          day.turns === 0
            ? 0
            : Math.max(1.5, peak > 0 ? (day.costUsd / peak) * 64 : 1.5)
        return (
          <rect
            key={day.date}
            x={index * step + step * 0.12}
            y={64 - height}
            width={step * 0.76}
            height={height}
            className={
              day.date === today ? 'fill-accent-fill' : 'fill-meter opacity-85'
            }
          />
        )
      })}
    </svg>
  )
}
