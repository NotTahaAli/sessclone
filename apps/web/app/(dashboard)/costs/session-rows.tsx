import Link from 'next/link'

import { hrefWith, type Query } from '../query'
import { Row, SectionBreak } from '../../_ui/primitives'
import { compact, count, usd } from '../../../lib/money'
import type { SessionRow } from '../../../lib/sessions'

// The Sessions under every Costs column (Taha, 2026-09-23): a day's, a
// person's, a Project's, a Device's, a model's. Sessions rather than Turns,
// because a Session is the thing a reader recognises and opens; its Turns are
// one click further, on the Session.
//
// The page is `sessionList`'s, the Sessions page's own statement, so the rows
// here and there cannot disagree. It reads the listed shelf (ticket 92): an
// archived Session's spend is in the column's totals and not in this list,
// as it is on the Sessions page.

export function SessionRows({
  page,
  timezone,
  empty,
  path,
  query,
  standalone = false,
}: {
  page: { sessions: SessionRow[]; more: boolean }
  timezone: string
  empty: string
  /** The page the next page is on, and its query, which it keeps. */
  path: string
  query: Query
  /** Set when `path` is a cut's own page: the Costs list's view and open
   * column mean nothing there. */
  standalone?: boolean
}) {
  const started = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  })
  const last = page.sessions.at(-1)

  return (
    <>
      <SectionBreak>Sessions</SectionBreak>
      {page.sessions.length === 0 ? (
        <p className="text-text-muted py-3 text-body">{empty}</p>
      ) : (
        <ol>
          {page.sessions.map((session) => {
            // Ticket 90: the Session's name, else its Project's, else the key.
            const named = session.label ?? session.projectName
            return (
              <li key={`${session.memberId}:${session.sessionId}`}>
                <Row
                  href={`/sessions/${encodeURIComponent(session.sessionId)}?member=${session.memberId}`}
                  value={usd(session.costUsd)}
                  sub={`${started.format(new Date(session.startedAt))} · ${compact.format(
                    session.tokens,
                  )} tokens${
                    session.unpricedTurns > 0
                      ? ` · ${count.format(session.unpricedTurns)} unpriced`
                      : ''
                  } · ${
                    session.memberName ??
                    session.memberEmail ??
                    'Outside your view'
                  }`}
                >
                  <span
                    className={
                      named
                        ? ''
                        : session.projectKey
                          ? 'font-mono'
                          : 'text-text-muted'
                    }
                  >
                    {named ?? session.projectKey ?? 'Outside a repository'}
                  </span>
                </Row>
              </li>
            )
          })}
        </ol>
      )}
      {/* The Sessions list's own cursor, so a boundary cannot repeat or skip
          a Session. */}
      {page.more && last ? (
        <p className="mt-3 text-body">
          <Link
            href={hrefWith(path, query, {
              before: `${last.lastTurnAt},${last.sessionId}`,
              ...(standalone ? { open: undefined, view: undefined } : {}),
            })}
            className="text-text-muted hover:text-text"
          >
            More sessions ›
          </Link>
        </p>
      ) : null}
    </>
  )
}
