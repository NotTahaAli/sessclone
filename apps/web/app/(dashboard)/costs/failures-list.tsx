import { adviceFor, type FailureTone } from '../../../lib/failure-advice'
import type { FailureRow, Failures } from '../../../lib/failures'

// Ticket 78: the failures list. One row per stop failure, drawn phone-first as
// a single column — the reader checks this from a phone when nothing arrived,
// so nothing here relies on a wide screen.
//
// Each row leads with the failure type as a monospace chip, coloured by what
// it means: red lost or needs a person, amber resolves itself, neutral for a
// type we have nothing to say about. Then when it failed, the Session, the
// Device and the Member — and a sentence saying what to do, or, when there is
// no advice for the type, the recorded message exactly as it was recorded.

const CHIP: Record<FailureTone, string> = {
  lost: 'bg-bad-bg text-bad-text border-bad-border',
  transient: 'bg-warn-bg text-warn-text border-warn-border',
  neutral: 'bg-quiet-bg text-quiet-text border-quiet-border',
}

/** A short session id: the tail carries no meaning a reader needs at a glance. */
const shortId = (id: string, limit = 20) =>
  id.length <= limit ? id : `${id.slice(0, limit)}…`

export function FailuresList({
  failures,
  timezone,
}: {
  failures: Failures
  /** The Org's timezone, so a time reads in the same zone the range is cut in. */
  timezone: string
}) {
  const when = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  })

  if (failures.rows.length === 0) {
    return (
      <p className="border-rule text-text-muted rounded border border-dashed p-6 text-sm">
        No Session failed in this period. A failure here is a turn that ended on
        an API error — a rate limit, an overload, a billing problem — so an
        empty list is the good outcome.
      </p>
    )
  }

  return (
    <ol className="flex flex-col">
      {failures.rows.map((row) => (
        <Row
          key={row.id}
          row={row}
          when={when.format(new Date(row.occurredAt))}
        />
      ))}
      {failures.more > 0 ? (
        <li className="text-text-muted py-3 text-caption">
          {new Intl.NumberFormat('en-US').format(failures.more)} more, below the
          most recent {failures.rows.length}. Narrow the period to see them.
        </li>
      ) : null}
    </ol>
  )
}

function Row({ row, when }: { row: FailureRow; when: string }) {
  const advice = adviceFor(row.errorType)

  // Who and where it failed, joined into one muted line: the Session always,
  // then the Device and Member when the viewer may see them.
  const context = [
    `Session ${shortId(row.sessionId)}`,
    row.agentId ? `agent ${shortId(row.agentId)}` : null,
    row.device ?? 'device not visible',
    row.member ?? 'member not visible',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <li className="border-rule flex flex-col gap-1.5 border-b py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span
          className={`rounded border px-2 py-0.5 font-mono text-caption ${CHIP[advice.tone]}`}
        >
          {row.errorType}
        </span>
        <time
          dateTime={row.occurredAt}
          className="text-text-muted font-mono text-caption"
        >
          {when}
        </time>
      </div>

      <p className="text-text-muted text-caption break-all">{context}</p>

      {/* Known type: the advice, and whether it touched the bill. Unknown type:
          the recorded message as recorded, never a generic stand-in. */}
      {advice.advice ? (
        <div className="flex flex-col gap-1">
          <p className="text-body text-text-secondary">{advice.advice}</p>
          <p className="text-caption">
            <span
              className={
                advice.costsAffected ? 'text-bad-text' : 'text-text-muted'
              }
            >
              {advice.costsAffected
                ? 'This affected your cost.'
                : 'Your cost is unaffected.'}
            </span>
          </p>
          {row.message ? (
            <p className="text-text-muted text-caption break-all">
              Reported: {row.message}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-body text-text-secondary break-all">
          {row.message ?? 'No message was recorded for this failure.'}
        </p>
      )}
    </li>
  )
}
