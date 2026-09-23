// Ticket 112: what a Session row's glyph says, and which day break it sits
// under. Pure, so the rules are tested rather than eyeballed.
//
// The data has no "running" column: Claude Code reports an end marker when a
// Session ends cleanly and nothing otherwise (ticket 05), and a cloud Session
// never reports one (ticket 95). So the glyph reads what there is:
//
//  - ✓ `ok`   — an end was reported.
//  - ✱ `live` — no end, and a Turn landed in the last LIVE_MS. Assumption,
//    stated: fifteen minutes. A turn in progress reports when it ends, so a
//    Session whose last report is that recent is very likely still at work.
//  - ○ `idle` — no end, and quiet since: killed, closed, or a cloud container
//    that will never say. Not an error, which is why it is the muted glyph.

export type SessionGlyph = 'live' | 'ok' | 'idle'

export const LIVE_MS = 15 * 60_000

export const sessionGlyph = (
  session: { endedAt: string | null; lastTurnAt: string },
  /** Defaulted here, not read in a component: a render stays pure. */
  now: number = Date.now(),
): SessionGlyph => {
  if (session.endedAt) return 'ok'
  return now - Date.parse(session.lastTurnAt) < LIVE_MS ? 'live' : 'idle'
}

/** The calendar date an instant falls on in `timezone`, as `YYYY-MM-DD`. */
export const localDate = (at: string | number, timezone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(at))

/** Today, in `timezone`, as `YYYY-MM-DD`. */
export const todayIn = (timezone: string) => localDate(Date.now(), timezone)

const named = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})

/** A day break's label: Today, Yesterday, or the date. */
export const dayLabel = (date: string, today: string) => {
  if (date === today) return 'Today'
  const yesterday = new Date(`${today}T00:00:00Z`)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  if (date === yesterday.toISOString().slice(0, 10)) return 'Yesterday'
  return named.format(new Date(`${date}T00:00:00Z`))
}
