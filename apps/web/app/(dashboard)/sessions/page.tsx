import Link from 'next/link'
import { Fragment } from 'react'

import { sessionDetailView, UUID } from './[sessionId]/detail'
import { SessionFilters } from './filters'
import { dayLabel, localDate, sessionGlyph, todayIn } from './status'
import { RangeControl } from '../costs/range-control'
import { EmptyState } from '../empty-state'
import { Finder, FinderColumn, FinderList } from '../finder'
import { PageHeader } from '../page-header'
import { hrefWith, one, type Query } from '../query'
import { Row, SectionBreak } from '../../_ui/primitives'
import { sessionsReads } from '../../../lib/page-reads'
import { resolveRange, type RangeParams } from '../../../lib/range'
import { compact, usd } from '../../../lib/money'
import { sessionCursorOf, type SessionRow } from '../../../lib/sessions'
import { currentViewer } from '../../../lib/viewer'

// Ticket 86: the Sessions of a period, and the way into one of them.
//
// It shares the period pill with Costs (ticket 53) rather than growing one of
// its own: the period lives in the URL, so a link to this list is a link to a
// period, and the reader moving between Costs and Sessions is asking two
// questions about one window.
//
// The Role scoping is the policies' (ADR 0001). A Member sees their own
// Sessions, a Manager their Scope's, an Owner or Admin the Org's — and this
// page contains no `where member_id =` of its own.
//
// Ticket 112 redraws it in Direction A: the filters are header pills, the
// rows sit under day breaks with the ✱ ✓ ○ glyph, and a row opens its Session
// in a column on the right on desktop (`?open=<member>:<session>`), the list
// staying in place. The reads are the ones the page made before.

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
  open?: string | string[]
}

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

  const [page, options] = await sessionsReads(viewer.userId, {
    orgId: viewer.orgId,
    timezone: viewer.orgTimezone,
    range: resolved.range,
    filter,
    before: sessionCursorOf(params.before),
  })

  // The open Session: `<member uuid>:<session id>`. A malformed value opens
  // nothing rather than failing the list.
  const open = one(params.open)
  const colon = open?.indexOf(':') ?? -1
  const openMember = open && colon > 0 ? open.slice(0, colon) : undefined
  const openSession = open && colon > 0 ? open.slice(colon + 1) : undefined
  const column =
    openMember && openSession && UUID.test(openMember)
      ? ((await sessionDetailView({
          viewer,
          member: openMember,
          sessionId: openSession,
          closeHref: hrefWith('/sessions', params, { open: undefined }),
        })) ?? (
          <p className="text-text-muted py-4 text-body">
            That session is not one you can read, or it does not exist.
          </p>
        ))
      : null

  const last = page.sessions.at(-1)
  const today = todayIn(viewer.orgTimezone)

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Sessions"
        actions={
          <>
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
            <RangeControl path="/sessions" resolved={resolved} query={params} />
          </>
        }
      />

      <Finder column={column !== null}>
        <FinderList column={column !== null}>
          {page.sessions.length === 0 ? (
            <EmptyState
              headline={
                state === 'archived'
                  ? 'No archived sessions in this period'
                  : 'No sessions in this period'
              }
            >
              Nothing matched these dates and filters. Widen the period above,
              or clear a filter.
            </EmptyState>
          ) : (
            <>
              <ol>
                {page.sessions.map((session, index) => {
                  const day = localDate(session.lastTurnAt, viewer.orgTimezone)
                  const previous = page.sessions[index - 1]
                  const breaks =
                    !previous ||
                    localDate(previous.lastTurnAt, viewer.orgTimezone) !== day
                  const key = `${session.memberId}:${session.sessionId}`
                  return (
                    <Fragment key={key}>
                      {breaks ? (
                        <li>
                          <SectionBreak as="h3">
                            {dayLabel(day, today)}
                          </SectionBreak>
                        </li>
                      ) : null}
                      <li>
                        <SessionLine
                          session={session}
                          glyph={sessionGlyph(session)}
                          href={hrefWith('/sessions', params, { open: key })}
                          selected={open === key}
                        />
                      </li>
                    </Fragment>
                  )
                })}
              </ol>
              {page.more && last ? (
                <p className="mt-3 text-body">
                  <Link
                    href={`/sessions?${nextPage(params, last)}`}
                    className="text-text-muted hover:text-text"
                  >
                    Older sessions ›
                  </Link>
                </p>
              ) : null}
            </>
          )}
        </FinderList>
        {column === null ? null : <FinderColumn>{column}</FinderColumn>}
      </Finder>
    </div>
  )
}

/**
 * One Session: its glyph, its name, how long it ran on the right, and who,
 * where and what it cost underneath.
 */
function SessionLine({
  session,
  glyph,
  href,
  selected,
}: {
  session: SessionRow
  glyph: 'live' | 'ok' | 'idle'
  href: string
  selected: boolean
}) {
  // Ticket 90: the name given to this Session, else the name given to its
  // Project, else the Project's key. A name is prose; a key is mono.
  const named = session.label ?? session.projectName
  return (
    <Row
      href={href}
      selected={selected}
      lead={glyph}
      // A Session with no end marker says so rather than showing a blank or
      // the last Turn's time dressed up as an ending (ticket 05); a cloud
      // container never reports one at all (ticket 95).
      meta={
        glyph === 'live'
          ? 'running'
          : session.endedAt
            ? (lasted(session) ?? 'ended')
            : session.cloud
              ? 'cloud, no end'
              : 'no end recorded'
      }
      sub={
        <>
          {session.memberName ?? session.memberEmail ?? 'Outside your view'}
          {session.deviceLabel ? ` · ${session.deviceLabel}` : ''}
          {/* The Project when the row's name was the Session's own, so a
              named Session still says where it ran. */}
          {session.label
            ? ` · ${session.projectName ?? session.projectKey ?? 'outside a repository'}`
            : ''}
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
          {' · '}
          <span className="text-text font-mono">{usd(session.costUsd)}</span>
        </>
      }
    >
      <span
        className={
          named ? '' : session.projectKey ? 'font-mono' : 'text-text-muted'
        }
      >
        {named ?? session.projectKey ?? 'Outside a repository'}
      </span>
    </Row>
  )
}

/** The same query plus the cursor: the period and the filters must survive. */
const nextPage = (params: Query, last: SessionRow) => {
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
