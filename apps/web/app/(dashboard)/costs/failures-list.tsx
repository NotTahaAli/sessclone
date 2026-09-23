import { markFailuresViewedAction } from './failure-actions'
import { one, type Query } from '../query'
import { Row } from '../../_ui/primitives'
import { adviceFor, type FailureTone } from '../../../lib/failure-advice'
import type { FailureRow, Failures } from '../../../lib/failures'

// Ticket 78: the failures list. One row per stop failure, drawn phone-first as
// a single column — the reader checks this from a phone when nothing arrived,
// so nothing here relies on a wide screen.
//
// Direction A (ticket 112): a row, not a card. The failure type leads in
// mono, in the colour of what it means — red lost or needs a person, amber
// resolves itself, muted for a type we have nothing to say about — with when
// it failed on the right. Under it the Session, Device and Member, then a
// sentence saying what to do, or, when there is no advice for the type, the
// recorded message exactly as it was recorded.

const TONE: Record<FailureTone, string> = {
  lost: 'text-bad-text',
  transient: 'text-warn-text',
  neutral: 'text-text',
}

const MARK: Record<FailureTone, string> = {
  lost: '✕',
  transient: '○',
  neutral: '○',
}

/** A short session id: the tail carries no meaning a reader needs at a glance. */
const shortId = (id: string, limit = 20) =>
  id.length <= limit ? id : `${id.slice(0, limit)}…`

export function FailuresList({
  failures,
  timezone,
  params,
}: {
  failures: Failures
  /** The Org's timezone, so a time reads in the same zone the range is cut in. */
  timezone: string
  /** The current query: the period a mark applies to rides in the form. */
  params: Query
}) {
  const when = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  })

  if (failures.rows.length === 0) {
    return (
      <p className="text-text-muted py-3 text-body">
        No Session failed in this period. A failure here is a turn that ended on
        an API error — a rate limit, an overload, a billing problem — so an
        empty list is the good outcome.
      </p>
    )
  }

  const unseen = failures.rows.some((row) => !row.viewed)

  return (
    <>
      {unseen ? (
        <form
          action={markFailuresViewedAction}
          className="-mt-1 mb-1 flex justify-end"
        >
          <Period params={params} />
          <button
            type="submit"
            className="text-text-muted hover:text-text text-caption underline underline-offset-2"
          >
            Mark all viewed
          </button>
        </form>
      ) : null}
      <ol className="flex flex-col">
        {failures.rows.map((row) => (
          <Failure
            key={row.id}
            row={row}
            params={params}
            when={when.format(new Date(row.occurredAt))}
          />
        ))}
        {failures.more > 0 ? (
          <li className="text-text-muted py-3 text-caption">
            {new Intl.NumberFormat('en-US').format(failures.more)} more, below
            the most recent {failures.rows.length}. Narrow the period to see
            them.
          </li>
        ) : null}
      </ol>
    </>
  )
}

/** The period the page shows, as hidden fields, so a mark covers the same
 * Sessions the reader is looking at. */
function Period({ params }: { params: Query }) {
  return (
    <>
      {(['range', 'from', 'to'] as const).map((key) => {
        const value = one(params[key])
        return value ? (
          <input key={key} type="hidden" name={key} value={value} />
        ) : null
      })}
    </>
  )
}

function Failure({
  row,
  when,
  params,
}: {
  row: FailureRow
  when: string
  params: Query
}) {
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
    <li
      className={`border-rule border-b pb-2 last:border-b-0 ${row.viewed ? 'opacity-70' : ''}`}
    >
      {/* The type is collector-controlled text of up to 64 characters
          (ticket 40's schema); the row truncates it rather than letting 64
          unbreakable characters push the page sideways on a phone. */}
      <Row
        mark={MARK[advice.tone]}
        markClass={TONE[advice.tone]}
        meta={when}
        sub={context}
      >
        <span
          title={row.errorType}
          className={`font-mono ${TONE[advice.tone]}`}
        >
          {row.errorType}
        </span>
      </Row>

      {/* Known type: the advice, and whether it touched the bill. Unknown type:
          the recorded message as recorded, never a generic stand-in. */}
      <div className="flex flex-col gap-1 pl-[22px] text-body">
        {advice.advice ? (
          <>
            <p className="text-text-secondary">{advice.advice}</p>
            <p
              className={`text-caption ${
                advice.costsAffected ? 'text-bad-text' : 'text-text-muted'
              }`}
            >
              {advice.costsAffected
                ? 'This affected your cost.'
                : 'Your cost is unaffected.'}
            </p>
            {row.message ? (
              <p className="text-text-muted text-caption break-all">
                Reported: {row.message}
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-text-secondary break-all">
            {row.message ?? 'No message was recorded for this failure.'}
          </p>
        )}
        {/* Viewed stays listed as the failure it was; it only stops being
            counted on the view pill, for this reader. */}
        {row.viewed ? (
          <p className="text-text-muted text-caption">✓ Viewed</p>
        ) : (
          <form action={markFailuresViewedAction}>
            <Period params={params} />
            <input type="hidden" name="memberId" value={row.memberId} />
            <input type="hidden" name="sessionId" value={row.sessionId} />
            <button
              type="submit"
              className="text-text-muted hover:text-text text-caption underline underline-offset-2"
            >
              Mark viewed
            </button>
          </form>
        )}
      </div>
    </li>
  )
}
