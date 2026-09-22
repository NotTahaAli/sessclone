import Link from 'next/link'

import { SessionFilters } from './filters'
import { RangeControl } from '../costs/range-control'
import { EmptyState } from '../empty-state'
import { PageHeader } from '../page-header'
import { asViewer } from '../../../lib/db'
import { resolveRange, type RangeParams } from '../../../lib/range'
import { compact, usd } from '../../../lib/money'
import {
  sessionFilters,
  sessionList,
  type SessionCursor,
  type SessionRow,
} from '../../../lib/sessions'
import { currentViewer } from '../../../lib/viewer'

// Ticket 86: the Sessions of a period, and the way into one of them.
//
// It shares the date-range control with Costs (ticket 53) rather than growing
// one of its own: the period lives in the URL, so a link to this list is a
// link to a period, and the reader moving between Costs and Sessions is
// asking two questions about one window.
//
// The Role scoping is the policies' (ADR 0001). A Member sees their own
// Sessions, a Manager their Scope's, an Owner or Admin the Org's — and this
// page contains no `where member_id =` of its own, which is what keeps that
// true when the Roles change.

const clock = (timezone: string) =>
  new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  })

const MINUTES = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

/** How long a Session ran, when it said it ended. */
const lasted = (session: SessionRow) => {
  if (!session.endedAt) return null
  const ms = Date.parse(session.endedAt) - Date.parse(session.startedAt)
  if (ms < 0) return null
  if (ms < 60_000) return `${MINUTES.format(ms / 1000)}s`
  if (ms < 3_600_000) return `${MINUTES.format(ms / 60_000)}m`
  return `${(ms / 3_600_000).toFixed(1)}h`
}

type Params = RangeParams & {
  project?: string | string[]
  member?: string | string[]
  state?: string | string[]
  q?: string | string[]
  failed?: string | string[]
  before?: string | string[]
}

const one = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value

export default async function Sessions({
  searchParams,
}: {
  searchParams: Promise<Params>
}) {
  const viewer = await currentViewer()
  if (!viewer) return null

  const params = await searchParams
  const resolved = resolveRange(params, viewer.orgTimezone)

  const project = one(params.project)
  const member = one(params.member)

  // Ticket 92. Anything that is not `archived` is the default shelf, rather
  // than an error: a hand-edited URL asking for a shelf that does not exist
  // should show the reader the ordinary list, not an empty one.
  const state =
    one(params.state) === 'archived' ? ('archived' as const) : undefined

  // Ticket 93. Trimmed, and an all-spaces box is no filter at all — a `%  %`
  // pattern would quietly return nothing and read as "no sessions".
  const search = one(params.q)?.trim() || undefined
  const failed = one(params.failed) === '1'

  const filter = {
    // `none` is the Sessions that ran outside a repository — a group rather
    // than a gap, and the same spelling every other surface uses for it.
    ...(project ? { projectId: project === 'none' ? null : project } : {}),
    ...(member ? { memberId: member } : {}),
    ...(state ? { state } : {}),
    ...(search ? { search } : {}),
    ...(failed ? { failedOnly: true } : {}),
  } as const

  const [page, options] = await asViewer(viewer.userId, (tx) =>
    Promise.all([
      sessionList(
        tx,
        viewer.orgId,
        viewer.orgTimezone,
        resolved.range,
        filter,
        { before: cursorOf(params.before) },
      ),
      sessionFilters(tx, viewer.orgId),
    ]),
  )

  const when = clock(viewer.orgTimezone)
  const last = page.sessions.at(-1)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Sessions"
        description={`Every session ${viewer.orgName} ran in this period, newest first.`}
      />

      <RangeControl path="/sessions" resolved={resolved} />

      <SessionFilters
        projects={options.projects}
        people={options.people}
        project={project}
        member={member}
        state={state}
        search={search}
        failed={failed}
        params={params}
      />

      {page.sessions.length === 0 ? (
        <EmptyState
          headline={
            state === 'archived'
              ? 'No archived sessions in this period'
              : 'No sessions in this period'
          }
        >
          Nothing matched these dates and filters. Widen the period above, or
          clear a filter.
        </EmptyState>
      ) : (
        <ol className="flex flex-col gap-3">
          {page.sessions.map((session) => (
            <li key={`${session.memberId}:${session.sessionId}`}>
              <Link
                href={`/sessions/${encodeURIComponent(session.sessionId)}?member=${session.memberId}`}
                className="border-rule bg-surface hover:bg-surface-hover block rounded-md border p-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  {/* Ticket 90: the name given to this Session, else the
                      name given to its Project, else the Project's key. A
                      name is not monospaced — it is prose, and a key is
                      not. */}
                  <span
                    className={
                      (session.label ?? session.projectName)
                        ? 'text-body break-all'
                        : session.projectKey
                          ? 'font-mono text-body break-all'
                          : 'text-body italic'
                    }
                  >
                    {session.label ??
                      session.projectName ??
                      session.projectKey ??
                      'Outside a repository'}
                  </span>
                  <span className="font-mono text-body">
                    {usd(session.costUsd)}
                  </span>
                </div>

                <p className="text-text-muted mt-1 text-caption break-all">
                  {when.format(new Date(session.startedAt))}
                  {' → '}
                  {/* A Session with no end marker says so rather than showing
                      a blank or the last Turn's time dressed up as an ending.
                      `SessionEnd` fires ~180ms after SIGTERM and not at all
                      under SIGKILL (ticket 05), so this is a common state and
                      an honest one. */}
                  {session.endedAt ? (
                    <>
                      {when.format(new Date(session.endedAt))}
                      {lasted(session) ? ` · ${lasted(session)}` : ''}
                    </>
                  ) : session.cloud ? (
                    // A cloud container never runs `SessionEnd`, archived
                    // or reclaimed (Taha, 2026-09-22), so the last Turn is
                    // the most that is known and is said as exactly that.
                    <>
                      last Turn {when.format(new Date(session.lastTurnAt))} ·
                      cloud, no end reported
                    </>
                  ) : (
                    <span className="text-warn-text">no end recorded</span>
                  )}
                </p>

                <p className="text-text-muted mt-1 text-caption break-all">
                  {session.turns} {session.turns === 1 ? 'Turn' : 'Turns'}
                  {session.agentRuns > 0
                    ? ` · ${session.agentRuns} ${
                        session.agentRuns === 1 ? 'subagent' : 'subagents'
                      }`
                    : ''}
                  {' · '}
                  {compact.format(session.tokens)} tokens
                  {session.unpricedTurns > 0
                    ? ` · ${session.unpricedTurns} unpriced`
                    : ''}
                </p>

                <p className="text-text-muted mt-1 text-caption break-all">
                  {session.memberName ??
                    session.memberEmail ??
                    'Outside your view'}
                  {session.deviceLabel ? ` · ${session.deviceLabel}` : ''}
                  {/* The Project when the row's headline was the Session's
                      own name, so a named Session still says where it ran. */}
                  {session.label
                    ? ` · ${session.projectName ?? session.projectKey ?? 'outside a repository'}`
                    : ''}
                </p>
              </Link>
            </li>
          ))}
        </ol>
      )}

      {page.more && last ? (
        <p>
          <Link
            href={`/sessions?${nextPage(params, last)}`}
            className="text-accent-text underline"
          >
            Older sessions
          </Link>
        </p>
      ) : null}
    </div>
  )
}

/** The same query plus the cursor: the period and the filters must survive. */
const nextPage = (params: Params, last: SessionRow) => {
  const search = new URLSearchParams()
  for (const key of [
    'range',
    'from',
    'to',
    'project',
    'member',
    'state',
    'q',
    'failed',
  ] as const) {
    const value = one(params[key])
    if (value) search.set(key, value)
  }
  search.set('before', `${last.lastTurnAt},${last.sessionId}`)
  return search.toString()
}

/** `<iso>,<session id>`, or nothing. Anything else shows the first page. */
const cursorOf = (
  value: string | string[] | undefined,
): SessionCursor | undefined => {
  const raw = one(value) ?? ''
  const comma = raw.indexOf(',')
  if (comma < 1) return undefined
  const lastTurnAt = raw.slice(0, comma)
  const sessionId = raw.slice(comma + 1)
  if (!sessionId || Number.isNaN(Date.parse(lastTurnAt))) return undefined
  return { lastTurnAt, sessionId }
}
