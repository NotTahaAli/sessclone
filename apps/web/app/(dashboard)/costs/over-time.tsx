import { dayName, Sparkline, Summary } from './summary'
import { sessionCount } from './token-table'
import { EmptyState } from '../empty-state'
import { hrefWith, type Query } from '../query'
import { todayIn } from '../sessions/status'
import { Row, SectionBreak } from '../../_ui/primitives'
import { compact, count, usd } from '../../../lib/money'
import type { SpendSeries } from '../../../lib/series'

/**
 * Spend over time: the summary with a bar a day beside it, then the models
 * the money went to and the days that had any.
 *
 * The By model rows are the legend of ticket 52's stacked chart, as rows: the
 * five largest models and Other, from the same series. The By day rows are
 * what that chart's table carried — the numbers a phone reader and a screen
 * reader get instead of a tooltip. Days with nothing in them are left out:
 * the bars already show the gap.
 */
export function OverTime({
  series,
  timezone,
  params,
  open,
}: {
  series: SpendSeries
  timezone: string
  /** The current query, so every link keeps the period. */
  params: Query
  /** The open column's key, `day:<date>` or `model:<name>`. */
  open: string | undefined
}) {
  if (series.turns === 0) {
    // Not the onboarding state: Turns exist, this window has none of them.
    return (
      <EmptyState headline="Nothing in this period">
        Turns have arrived, but none of them fall between these dates. Pick a
        wider period above.
      </EmptyState>
    )
  }

  const peak = Math.max(...series.series.map((entry) => entry.costUsd), 0)
  const used = series.days.filter((day) => day.turns > 0).toReversed()

  return (
    <>
      <Summary
        costUsd={series.costUsd}
        tokens={series.tokens}
        sessions={series.sessions}
        unpricedTurns={series.unpricedTurns}
      >
        <Sparkline
          days={series.days}
          today={todayIn(timezone)}
          params={params}
          open={open?.startsWith('day:') ? open.slice(4) : undefined}
        />
      </Summary>

      {series.series.length > 0 ? (
        <>
          <SectionBreak>By model</SectionBreak>
          <ol>
            {series.series.map((entry) => {
              // Other is several models rolled up, so it has no one
              // breakdown to open; every named row does.
              const key = `model:${entry.label}`
              const openable = entry.slot !== 'other'
              return (
                <li key={entry.label}>
                  <Row
                    lead={openable ? undefined : 'none'}
                    href={
                      openable
                        ? hrefWith('/costs', params, { open: key })
                        : undefined
                    }
                    selected={openable && open === key}
                    value={usd(entry.costUsd)}
                    meter={peak > 0 ? entry.costUsd / peak : 0}
                  >
                    <span className="font-mono">{entry.label}</span>
                  </Row>
                </li>
              )
            })}
          </ol>
        </>
      ) : null}

      <SectionBreak>By day</SectionBreak>
      <ol>
        {used.map((day) => (
          <li key={day.date}>
            <Row
              href={hrefWith('/costs', params, { open: `day:${day.date}` })}
              selected={open === `day:${day.date}`}
              name={dayName(day.date)}
              // A day whose every Turn is unpriced is unknown, not zero.
              value={day.unpricedTurns === day.turns ? '—' : usd(day.costUsd)}
              sub={`${compact.format(day.tokens)} tokens · ${sessionCount(
                day.sessions,
              )}${
                day.unpricedTurns > 0
                  ? ` · ${count.format(day.unpricedTurns)} unpriced`
                  : ''
              }`}
            />
          </li>
        ))}
      </ol>

      <p className="text-text-muted mt-4 text-caption">
        Cost is an estimate, derived from the usage reported and the published
        prices. Days are the Org&apos;s own.
      </p>
    </>
  )
}
