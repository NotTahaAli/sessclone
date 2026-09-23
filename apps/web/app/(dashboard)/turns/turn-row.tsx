import { Row } from '../../_ui/primitives'
import type { TurnRow as TurnRowData } from '../../../lib/turns'
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
//
// Direction A's row (ticket 112): the time as the name, the cost as the
// right-aligned mono figure, and the model, where it ran and its tokens on the
// line under.

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
  turns: TurnRowData[]
  timezone: string
  showSession?: boolean
  empty: string
}) {
  if (turns.length === 0) {
    return <p className="text-text-muted py-3 text-body">{empty}</p>
  }

  const when = clock(timezone)

  return (
    <ol className="flex flex-col">
      {turns.map((turn) => (
        <li key={turn.id}>
          {/* A dash, never $0.00, when a quantity it consumed has no Rate
              (ADR 0002); the sub line says "unpriced" beside it, so the dash
              is never left to be read as a rendering failure. */}
          <Row
            href={`/turns/${turn.id}`}
            name={when.format(new Date(turn.occurredAt))}
            value={usd(turn.costUsd)}
            sub={
              <>
                <span className="font-mono">
                  {turn.model ?? 'no model reported'}
                </span>
                {' · '}
                {showSession ? `${turn.sessionId} · ` : ''}
                {turn.agentId ? `subagent ${turn.agentId} · ` : ''}
                {turn.projectKey ?? 'no project reported'}
                {' · '}
                {compact.format(turn.tokens)} tokens
                {turn.unpriced ? ' · unpriced' : ''}
                {turn.complete ? '' : ' · incomplete'}
              </>
            }
          />
        </li>
      ))}
    </ol>
  )
}
