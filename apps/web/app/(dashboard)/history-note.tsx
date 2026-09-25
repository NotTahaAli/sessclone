import { addDays, type LocalRange } from '../../lib/series'
import { todayIn } from './sessions/status'

// With the year: the floor is often last year's date.
const day = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

/**
 * Ticket 139: said once, under the header, when the period asked for reaches
 * back past what the plan shows. The read policy has already hidden those
 * Turns; this is why the chart is empty there.
 */
export function HistoryNote({
  range,
  historyDays,
  timezone,
}: {
  range: LocalRange
  historyDays: number | null
  timezone: string
}) {
  if (historyDays === null) return null
  const today = todayIn(timezone)
  const floor = addDays(today, -historyDays)
  if (range.from >= floor) return null
  return (
    <p className="text-text-muted py-2 text-caption">
      Your plan shows the last {historyDays} days. Turns before{' '}
      {day.format(new Date(`${floor}T00:00:00Z`))} are kept but hidden;
      upgrading shows them again.
    </p>
  )
}
