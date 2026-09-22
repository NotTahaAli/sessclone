import Link from 'next/link'

import type { TurnRow as Row } from '../../../lib/turns'
import { compact, usd } from '../../../lib/money'

// The Turn row, built once and rendered by both callers that list Turns: the
// Costs drill-down (ticket 88) and a Session's detail (ticket 86). The ticket
// says so outright — "One implementation, two callers" — so the differences
// between the two surfaces are props rather than a second component.
//
// It is a link rather than a disclosure. The breakdown is seven Rates resolved
// per Turn, and expanding in place would mean resolving them for every row on
// the page to render one of them; `/turns/<id>` reads one Turn when a reader
// asks for one, and is a URL that can be sent to whoever asks "what was this".

/** The time, in the Org's timezone — the same zone every other figure is cut
 * in, so a Turn at 23:50 lands on the day the chart put it on. */
const clock = (timezone: string) =>
  new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  })

export function TurnRows({
  turns,
  timezone,
  /**
   * Whether the session id belongs on the row. It is the subject of the page
   * on a Session's detail, where repeating it on all fifty rows says nothing;
   * on the Costs drill-down it is the one thing that tells the rows apart.
   */
  showSession = true,
  empty,
}: {
  turns: Row[]
  timezone: string
  showSession?: boolean
  empty: string
}) {
  if (turns.length === 0) {
    return (
      <p className="border-rule text-text-muted rounded border border-dashed p-6 text-sm">
        {empty}
      </p>
    )
  }

  const when = clock(timezone)

  return (
    <ol className="flex flex-col">
      {turns.map((turn) => (
        <li key={turn.id} className="border-rule border-b last:border-b-0">
          <Link
            href={`/turns/${turn.id}`}
            // Not wrapping: at 390px the cost otherwise drops under the time
            // and sits on the left, where it reads as part of the row's
            // subtitle rather than as the figure the row is about. The left
            // column shrinks instead, which is what `min-w-0` is for.
            className="hover:bg-surface-hover flex items-baseline justify-between gap-x-4 px-2 py-3"
          >
            {/* The time on its own line and the model below it, rather than
                the two joined: at 390px a joined line breaks inside the model
                identifier, and `claude-` above `opus-4-6` is the one string on
                the row nobody can read broken. */}
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-body whitespace-nowrap">
                {when.format(new Date(turn.occurredAt))}
              </span>
              <span className="text-text-muted text-caption break-all">
                {turn.model ? (
                  <span className="text-text-secondary font-mono">
                    {turn.model}
                  </span>
                ) : (
                  'no model reported'
                )}
                {' · '}
                {showSession ? `${turn.sessionId} · ` : ''}
                {turn.agentId ? `subagent ${turn.agentId} · ` : ''}
                {turn.projectKey ?? 'no project reported'}
              </span>
            </span>

            <span className="flex shrink-0 flex-col items-end gap-0.5 text-right">
              {/* A dash, never $0.00, when a quantity it consumed has no Rate
                  (ADR 0002). The caption below says which state it is in, so
                  the dash is never left to be read as a rendering failure. */}
              <span className="font-mono text-body">{usd(turn.costUsd)}</span>
              <span className="text-text-muted text-caption">
                {compact.format(turn.tokens)} tokens
                {turn.unpriced ? ' · unpriced' : ''}
                {turn.complete ? '' : ' · incomplete'}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ol>
  )
}
