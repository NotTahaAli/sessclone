import Link from 'next/link'

import { labelSessionAction } from './actions'
import { Shelf } from './shelf'
import { DownloadTranscript } from './transcript/download'
import { ColumnHead } from '../../finder'
import { InlineName } from '../../inline-name'
import { PageHeader } from '../../page-header'
import { Summary } from '../../costs/summary'
import { TurnRows } from '../../turns/turn-row'
import { sessionGlyph } from '../status'
import { Row, SectionBreak, StatusGlyph } from '../../../_ui/primitives'
import { asViewer } from '../../../../lib/db'
import { compact, count, usd } from '../../../../lib/money'
import {
  archivalReason,
  sessionDetail,
  sessionModels,
  sessionTranscripts,
  type AgentRun,
  type SessionModel,
  type SessionRow,
  type StoredTranscript,
} from '../../../../lib/sessions'
import { turnList, type TurnCursor } from '../../../../lib/turns'
import type { Viewer } from '../../../../lib/viewer'

// Ticket 86's second half — one Session, and what ran inside it — drawn two
// ways since ticket 112: as its own page, and as the Finder column beside the
// Sessions list on desktop. One component, so the two agree.
//
// The Member is in the query rather than only the session id, and that is not
// decoration. `turns_identity_key` and `session_events_session_idx` both lead
// on `member_id`, so a read by session id alone has no index behind it and
// would scan every Turn on the deployment. It is not authorisation either way:
// `turns_read` is, and a member id belonging to somebody the viewer may not
// see returns no rows — the same answer as a Session that does not exist.
//
// Nothing here is bounded by the period the reader came from. A Session that
// straddles midnight on the last day of a month is one Session, and a detail
// that cut it at the boundary would show a total disagreeing with itself.

const clock = (timezone: string) =>
  new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  })

const BYTES = ['bytes', 'KB', 'MB', 'GB', 'TB']

/** Three significant figures, as `stored-transcripts.tsx` shows a size. */
export const size = (bytes: number) => {
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < BYTES.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${unit === 0 ? value : value.toFixed(value < 10 ? 1 : 0)} ${BYTES[unit]}`
}

/** A member id is a uuid; anything else would be a cast error, not a miss. */
/** One shared empty list, so a missing page is not a new array per render. */
const NO_TURNS: never[] = []

export const UUID = /^[0-9a-f-]{1,64}$/i

/**
 * The Session's detail, or null when there is no such Session for this
 * viewer. `closeHref` makes it the Finder column: a compact head, the cost by
 * model and the ways further in, with the full Turn list left to the page.
 */
export async function sessionDetailView({
  viewer,
  member,
  sessionId,
  after,
  closeHref,
}: {
  viewer: Viewer
  member: string
  sessionId: string
  after?: string
  closeHref?: string
}) {
  const column = closeHref !== undefined
  const detail = await asViewer(viewer.userId, async (tx) => {
    const found = await sessionDetail(tx, viewer.orgId, member, sessionId)
    if (!found) return null

    // The reads that depend on the Session existing, together rather than one
    // after another: they are independent of each other. The column shows no
    // Turn list, so it does not read one.
    const [page, transcripts, archival, models] = await Promise.all([
      column
        ? null
        : turnList(
            tx,
            viewer.orgId,
            {
              kind: 'session',
              memberId: member,
              sessionId: found.session.sessionId,
            },
            { order: 'asc', before: cursorOf(after) },
          ),
      sessionTranscripts(tx, member, found.session.sessionId),
      transcriptReasonFor(tx, member, found.session),
      sessionModels(tx, viewer.orgId, member, found.session.sessionId),
    ])

    return { ...found, page, transcripts, archival, models }
  })

  if (!detail) return null

  const { session, agentRuns, page, transcripts, archival, models } = detail
  const when = clock(viewer.orgTimezone)
  const glyph = sessionGlyph(session)
  const pagePath = `/sessions/${encodeURIComponent(session.sessionId)}?member=${member}`
  const viewPath = `/sessions/${encodeURIComponent(session.sessionId)}/transcript?member=${member}`

  // Ticket 90: the name when somebody has given this Session one, the Project
  // it ran against when they have not, and a pencil beside it either way.
  const title = (
    <InlineName
      action={labelSessionAction}
      hidden={`memberId=${member}&sessionId=${encodeURIComponent(session.sessionId)}`}
      current={session.label}
      fallback={project(session) ?? 'Session outside a repository'}
      label="Name for this Session"
      placeholder="Thursday's migration"
      mono
    />
  )

  // The session id and the Project key stay under the name — they are the
  // identity, and a name that hid them would make two Sessions
  // indistinguishable.
  const identity = `${person(session)}${
    session.deviceLabel ? ` · ${session.deviceLabel}` : ''
  }${session.label && project(session) ? ` · ${project(session)}` : ''}${
    session.label || !session.projectName ? '' : ` · ${session.projectKey}`
  } · ${session.sessionId}`

  return (
    <div className="flex flex-col">
      {column ? (
        <ColumnHead
          glyph={glyph}
          closeHref={closeHref}
          sub={
            <>
              {identity}
              <br />
              <Timing session={session} when={when} />
            </>
          }
        >
          {title}
        </ColumnHead>
      ) : (
        <>
          <PageHeader>
            <span className="inline-flex items-baseline gap-2">
              <span className="text-body">
                <StatusGlyph state={glyph} />
              </span>
              {title}
            </span>
          </PageHeader>
          <p className="text-text-muted mt-2 text-caption break-all">
            {identity}
          </p>
        </>
      )}

      <Summary
        label="Cost"
        costUsd={session.costUsd}
        tokens={session.tokens}
        turns={session.turns}
        unpricedTurns={session.unpricedTurns}
      />
      {column ? null : (
        <p className="text-text-muted mt-1 text-caption">
          <Timing session={session} when={when} />
          {session.agentRuns > 0
            ? ` · ${session.agentRuns} subagent ${
                session.agentRuns === 1 ? 'run' : 'runs'
              } inside`
            : ''}
        </p>
      )}

      {/* Ticket 92. Under the summary rather than beside the name: it is a
          thing you do once you have looked, not part of what the Session
          is. */}
      <div className="mt-3">
        <Shelf
          memberId={member}
          sessionId={session.sessionId}
          current={session.state}
        />
      </div>

      <Models models={models} />

      <Transcripts
        transcripts={transcripts}
        archival={archival}
        agentRuns={agentRuns.length}
        view={viewPath}
        sessionId={session.sessionId}
        memberId={member}
      />

      {column ? (
        <>
          <SectionBreak>Open</SectionBreak>
          <Row
            href={pagePath}
            name="Turns"
            meta={count.format(session.turns)}
            sub={
              agentRuns.length > 0
                ? `${agentRuns.length} subagent ${
                    agentRuns.length === 1 ? 'run' : 'runs'
                  } among them`
                : undefined
            }
          />
        </>
      ) : (
        <>
          {agentRuns.length > 0 ? (
            <AgentRuns runs={agentRuns} when={when} />
          ) : null}
          <SectionBreak>Turns, in the order they ran</SectionBreak>
          <TurnRows
            turns={page?.turns ?? NO_TURNS}
            timezone={viewer.orgTimezone}
            showSession={false}
            empty="No Turns are readable for this session."
          />
          {page?.more && page.turns.at(-1) ? (
            <p className="mt-3 text-body">
              <Link
                href={`${pagePath}&after=${page.turns.at(-1)!.occurredAt},${page.turns.at(-1)!.id}`}
                className="text-text-muted hover:text-text"
              >
                Later Turns ›
              </Link>
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}

/**
 * When it ran. A Session with no end marker says so rather than showing a
 * blank or the last Turn's time dressed up as an ending: `SessionEnd` fires
 * about 180ms after SIGTERM and never under SIGKILL (ticket 05), and a cloud
 * container never runs it at all (ticket 95).
 */
function Timing({
  session,
  when,
}: {
  session: SessionRow
  when: Intl.DateTimeFormat
}) {
  return (
    <>
      started {when.format(new Date(session.startedAt))} ·{' '}
      {session.endedAt
        ? `ended ${when.format(new Date(session.endedAt))}`
        : session.cloud
          ? `last Turn ${when.format(new Date(session.lastTurnAt))}, cloud sessions report no end`
          : `last Turn ${when.format(new Date(session.lastTurnAt))}, no end marker — killed, or still running`}
    </>
  )
}

/** The Project, by the name it has been given or by its key (ticket 90). */
const project = (session: SessionRow) =>
  session.projectName ?? session.projectKey

/** The person, by the name they set for themselves and their address
 * (ticket 91): an address identifies and a name labels. */
const person = (session: SessionRow) =>
  session.memberName
    ? `${session.memberName} (${session.memberEmail ?? 'address hidden'})`
    : (session.memberEmail ?? 'Outside your view')

/**
 * Tickets 89 and 94: what this Session spent, per model, and where the tokens
 * went — the same aggregate as the summary with one more column in the
 * `group by`, so the rows sum to the figure above them.
 *
 * Ticket 94's four token classes, which answer "why" where the total answers
 * "how much" (it is almost always the cache), ride on the row's sub line. A
 * model with nothing priced shows a dash and says how many Turns are behind
 * it — never `$0.00` (ADR 0002).
 */
function Models({ models }: { models: SessionModel[] }) {
  if (models.length === 0) return null
  return (
    <>
      <SectionBreak>Cost by model</SectionBreak>
      <ol>
        {models.map((model) => (
          <li key={model.model ?? 'none'}>
            <Row
              lead="none"
              value={usd(model.costUsd)}
              sub={
                <>
                  {count.format(model.turns)}{' '}
                  {model.turns === 1 ? 'Turn' : 'Turns'} · in{' '}
                  {compact.format(model.inputTokens)} · out{' '}
                  {compact.format(model.outputTokens)} · cache read{' '}
                  {compact.format(model.cacheReadTokens)} · cache write{' '}
                  {compact.format(model.cacheWriteTokens)}
                  {model.unpricedTurns === 0
                    ? ''
                    : model.costUsd === null
                      ? ` · ${model.unpricedTurns} Turns, no Rate`
                      : ` · at least: ${model.unpricedTurns} unpriced`}
                </>
              }
            >
              <span className="font-mono">
                {model.model ?? 'No model reported'}
              </span>
            </Row>
          </li>
        ))}
      </ol>
    </>
  )
}

/**
 * The Agent Runs, grouped under the Session they reported against.
 *
 * Finding 74: a subagent writes its own transcript under the parent's session
 * id with an `agent_id` of its own, so these are a grouping of the Turns
 * listed below rather than a second set of rows.
 */
function AgentRuns({
  runs,
  when,
}: {
  runs: AgentRun[]
  when: Intl.DateTimeFormat
}) {
  return (
    <>
      <SectionBreak>Subagents</SectionBreak>
      <ol>
        {runs.map((run) => (
          <li key={run.agentId}>
            <Row
              lead="none"
              value={usd(run.costUsd)}
              sub={`${when.format(new Date(run.startedAt))} · ${count.format(
                run.turns,
              )} ${run.turns === 1 ? 'Turn' : 'Turns'} · ${compact.format(
                run.tokens,
              )} tokens${
                run.spawnDepth === null ? '' : ` · depth ${run.spawnDepth}`
              }${run.unpricedTurns > 0 ? ` · ${run.unpricedTurns} unpriced` : ''}`}
            >
              <span className="font-mono">{run.agentId}</span>
            </Row>
          </li>
        ))}
      </ol>
    </>
  )
}

/**
 * The transcript, or why there is none.
 *
 * Ticket 86 is explicit that an absent transcript is shown with its reason
 * rather than hidden: "an absent link reads as a bug". Archival is opt-in per
 * Member and off by default (ADR 0005), so no transcript is the ordinary case.
 */
function Transcripts({
  transcripts,
  archival,
  agentRuns,
  view,
  sessionId,
  memberId,
}: {
  sessionId: string
  memberId: string
  transcripts: StoredTranscript[]
  archival: 'off' | 'excluded' | 'on' | null
  agentRuns: number
  /** Tickets 105-108: the transcript viewer, for the Session's own file. */
  view: string
}) {
  return (
    <>
      <SectionBreak>Transcript</SectionBreak>
      {transcripts.length === 0 ? (
        <p className="text-text-muted py-1 text-body">
          {archival === 'off'
            ? 'No transcript was stored. Archival is off for this person — it is theirs to turn on, and nobody else in the Org can do it for them.'
            : archival === 'excluded'
              ? 'No transcript was stored. This Project is excluded from archival for this person.'
              : archival === 'on'
                ? // Deliberately a list rather than a diagnosis: the exception
                  // list is the Member's own to read (ADR 0005), so an Admin
                  // looking at somebody else's Session cannot tell an excluded
                  // Project from an unexcluded one.
                  'No transcript was stored. This person’s archival switch is on, so: the session may still be running, it may have been killed before it uploaded, this Project may be excluded from their archival, or the transcript has aged out under Retention.'
                : 'No transcript was stored, and this person’s archival setting is not yours to read.'}
        </p>
      ) : (
        <ol>
          {transcripts.map((transcript) => (
            <li key={transcript.id}>
              {/* The Session's own file opens in the viewer; a subagent's is a
                  download. A download is a GET — bookmarkable, retryable — and
                  the route redirects to storage so the bytes never come
                  through the application (ticket 60). A new tab, because
                  every failure of that route answers with plain text. */}
              <Row
                href={transcript.agentId ? undefined : view}
                lead={transcript.agentId ? 'none' : undefined}
                name={
                  transcript.agentId
                    ? `Subagent ${transcript.agentId}`
                    : 'The session'
                }
                meta={size(transcript.bytes)}
                sub={transcript.agentId ? undefined : 'Open in the viewer'}
              />
              <p className="pl-[22px] text-caption">
                {transcript.chunked ? (
                  // Ticket 133: assembled in the browser from its chunks.
                  <DownloadTranscript
                    sessionId={sessionId}
                    memberId={memberId}
                    agentId={transcript.agentId}
                    className="text-text-muted hover:text-text underline"
                    label={
                      transcript.agentId
                        ? `Download the transcript of subagent ${transcript.agentId}`
                        : 'Download the transcript of this session'
                    }
                  />
                ) : (
                  <a
                    href={`/api/logs/download/${transcript.id}`}
                    target="_blank"
                    rel="noopener"
                    className="text-text-muted hover:text-text underline"
                  >
                    Download
                  </a>
                )}
              </p>
            </li>
          ))}
        </ol>
      )}

      {transcripts.length > 0 && agentRuns >= transcripts.length ? (
        <p className="text-text-muted mt-1 text-caption">
          A subagent writes its own transcript under the same session id
          (finding 74), so a run with no row here uploaded nothing.
        </p>
      ) : null}
    </>
  )
}

/**
 * The archival reason, asked for only when it is going to be used.
 *
 * It needs the Session's Project id, which the summary does not carry — the
 * row names the Project by key. One extra statement, and only here.
 */
const transcriptReasonFor = async (
  tx: Parameters<typeof archivalReason>[0],
  memberId: string,
  session: SessionRow,
) => {
  const [row] = await tx<{ project_id: string | null }[]>`
    select project_id
      from turns
     where member_id = ${memberId}
       and session_id = ${session.sessionId}
     limit 1
  `
  return archivalReason(tx, memberId, row?.project_id ?? null)
}

/** `<iso>,<turn id>`, or nothing. Anything else shows the first page. */
const cursorOf = (value: string | undefined): TurnCursor | undefined => {
  const [at, id] = (value ?? '').split(',')
  if (!at || !id || !/^\d+$/.test(id)) return undefined
  return Number.isNaN(Date.parse(at)) ? undefined : { occurredAt: at, id }
}
