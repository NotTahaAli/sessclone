import Link from 'next/link'
import type { ReactNode } from 'react'

import { tickDates } from './views'
import { hrefWith, type Query } from '../query'

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
  sessions,
  turns,
  unpricedTurns,
  label = 'Spent',
  children,
}: {
  costUsd: number | null
  tokens: number
  /** How many Sessions; every Costs figure counts these. */
  sessions?: number
  /** How many Turns, in place of Sessions: a Session's own summary, where
   * "1 session" would say nothing. */
  turns?: number
  unpricedTurns: number
  label?: string
  /** The sparkline, beside the figure when the list is wide and under it
   * when it is not: a phone, or a desktop with a Finder column open. */
  children?: ReactNode
}) {
  return (
    <div className="@container">
      <div className="grid gap-x-7 gap-y-3 pt-4 pb-1 @3xl:grid-cols-[auto_minmax(0,1fr)] @3xl:items-end">
        <div>
          <p className="text-text-muted text-label uppercase">{label}</p>
          <p className="font-mono text-figure-xl tabular-nums">
            {usd(costUsd)}
          </p>
          <p className="text-text-muted mt-1.5 flex flex-wrap gap-x-5 text-[13px]">
            <span>
              <b className="text-text font-mono font-medium">
                {compact.format(tokens)}
              </b>{' '}
              tokens
            </span>
            <span>
              <b className="text-text font-mono font-medium">
                {count.format(turns ?? sessions ?? 0)}
              </b>{' '}
              {turns === undefined
                ? sessions === 1
                  ? 'session'
                  : 'sessions'
                : turns === 1
                  ? 'turn'
                  : 'turns'}
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
 * One bar a day across the whole period, today's in the accent — the one bar
 * on the page that is "now" — every other in the meter ink.
 *
 * Every day has a slot, a day with nothing in it included: it draws a 2px
 * stub on the baseline, so the reader can see where each day sits and which
 * ones were empty. The first and last day and today are labelled under the
 * bars. Each bar is a link to its day (the Finder column the By day rows
 * open) and says its date and figure to a screen reader and on hover.
 *
 * Bars rather than one stretched SVG: a single viewBox stretched to the width
 * drew nothing at all for an empty day and left the days with Turns floating
 * with no baseline to sit on (Taha, 2026-09-23).
 */
export function Sparkline({
  days,
  today,
  params,
  open,
}: {
  days: Day[]
  today: string
  /** The current query, so a bar's link keeps the period. */
  params: Query
  /** The date whose column is open, if one is. */
  open?: string
}) {
  const peak = Math.max(...days.map((day) => day.costUsd), 0)
  const ticks = new Set(
    tickDates(
      days.map((day) => day.date),
      today,
    ),
  )
  const first = days[0]?.date
  const last = days.at(-1)?.date

  return (
    <div className="min-w-0">
      <ol
        aria-label="Spend per day"
        className="border-rule flex h-12 items-end gap-px border-b sm:gap-[3px] @3xl:h-16"
      >
        {days.map((day) => {
          // Share of the tallest day, with a floor so a small day with Turns
          // still reads as a bar; an empty day is the stub under it.
          const share =
            day.turns === 0 || peak === 0
              ? 0
              : Math.max(0.06, day.costUsd / peak)
          const figure =
            day.turns === 0
              ? 'nothing'
              : day.unpricedTurns === day.turns
                ? 'unpriced'
                : usd(day.costUsd)
          const label = `${dayName(day.date)}: ${figure}`
          const tone =
            day.date === today
              ? 'fill-accent-fill'
              : day.turns === 0
                ? 'fill-rule-strong'
                : 'fill-meter opacity-85'
          return (
            <li key={day.date} className="flex h-full min-w-0 flex-1">
              <Link
                href={hrefWith('/costs', params, { open: `day:${day.date}` })}
                aria-label={label}
                aria-current={open === day.date ? 'true' : undefined}
                title={label}
                className="group flex h-full w-full items-end rounded-t-[1px] hover:bg-surface-hover aria-[current]:bg-selected"
              >
                <svg
                  aria-hidden="true"
                  className="block w-full overflow-visible"
                  height={share === 0 ? 2 : `${Math.round(share * 100)}%`}
                  preserveAspectRatio="none"
                >
                  <rect width="100%" height="100%" className={tone} />
                </svg>
              </Link>
            </li>
          )
        })}
      </ol>
      <ol
        aria-hidden="true"
        className="text-text-muted mt-1 flex gap-px font-mono text-[11px] sm:gap-[3px]"
      >
        {days.map((day) => (
          <li
            key={day.date}
            className={`relative flex min-w-0 flex-1 ${
              day.date === first
                ? 'justify-start'
                : day.date === last
                  ? 'justify-end'
                  : 'justify-center'
            }`}
          >
            {ticks.has(day.date) ? (
              <span
                className={`whitespace-nowrap ${day.date === today ? 'text-accent-text' : ''}`}
              >
                {dayName(day.date)}
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  )
}
