import Link from 'next/link'
import { notFound } from 'next/navigation'

import { labelSessionAction } from './actions'
import { TurnRows } from '../../turns/turn-row'
import { InlineName } from '../../inline-name'
import { Shelf } from './shelf'
import { PageHeader } from '../../page-header'
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
import { currentViewer } from '../../../../lib/viewer'

// Ticket 86's second half: one Session, and what ran inside it.
//
// The Member is in the query rather than only the session id, and that is not
// decoration. `turns_identity_key` and `session_events_session_idx` both lead
// on `member_id`, so a read by session id alone has no index behind it and
// would scan every Turn on the deployment — the ticket's own criterion is that
// the reads are index-backed. It is not authorisation either way: `turns_read`
// is, and a member id belonging to somebody the viewer may not see returns no
// rows and lands on the same 404 as a Session that does not exist.
//
// Nothing here is bounded by the period the reader came from. A Session that
// straddles midnight on the last day of a month is one Session, and a detail
// page that cut it at the boundary would show a total disagreeing with itself.

const clock = (timezone: string) =>
  new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  })

const BYTES = ['bytes', 'KB', 'MB', 'GB', 'TB']

/** Three significant figures, as `stored-transcripts.tsx` shows a size. */
const size = (bytes: number) => {
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < BYTES.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${unit === 0 ? value : value.toFixed(value < 10 ? 1 : 0)} ${BYTES[unit]}`
}

const UUID = /^[0-9a-f-]{1,64}$/i

export default async function Session({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>
  searchParams: Promise<{ member?: string; after?: string }>
}) {
  const viewer = await currentViewer()
  if (!viewer) return null

  const { sessionId } = await params
  const { member, after } = await searchParams

  // A member id is a uuid and the statements compare it as one, so anything
  // else would be a cast error rather than an empty result. Refuse it here: a
  // hand-typed URL is a 404, not a 500.
  if (!member || !UUID.test(member)) notFound()

  const detail = await asViewer(viewer.userId, async (tx) => {
    const found = await sessionDetail(
      tx,
      viewer.orgId,
      member,
      decodeURIComponent(sessionId),
    )
    if (!found) return null

    // The four reads that depend on the Session existing, together rather
    // than one after another: they are independent of each other.
    const [page, transcripts, archival, models] = await Promise.all([
      turnList(
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

  if (!detail) notFound()

  const { session, agentRuns, page, transcripts, archival, models } = detail
  const when = clock(viewer.orgTimezone)
  const last = page.turns.at(-1)

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {/* Ticket 90: the name when somebody has given this Session one, the
          Project it ran against when they have not, and a pencil beside it
          either way. The session id and the Project key stay underneath —
          they are the identity, and a name that hid them would make two
          Sessions indistinguishable. */}
      <PageHeader
        description={`${person(session)}${
          session.deviceLabel ? ` · ${session.deviceLabel}` : ''
        }${session.label && project(session) ? ` · ${project(session)}` : ''}${
          session.label || !session.projectName
            ? ''
            : ` · ${session.projectKey}`
        } · ${session.sessionId}`}
      >
        <InlineName
          action={labelSessionAction}
          hidden={`memberId=${member}&sessionId=${encodeURIComponent(session.sessionId)}`}
          current={session.label}
          fallback={project(session) ?? 'Session outside a repository'}
          label="Name for this Session"
          placeholder="Thursday's migration"
          mono
        />
      </PageHeader>

      <Summary session={session} when={when} />

      {/* Ticket 92. Under the summary rather than beside the name: it is a
          thing you do once you have looked, not part of what the Session
          is. */}
      <Shelf
        memberId={member}
        sessionId={session.sessionId}
        current={session.state}
      />

      <Models models={models} />

      <Transcripts
        transcripts={transcripts}
        archival={archival}
        agentRuns={agentRuns.length}
      />

      {agentRuns.length > 0 ? <AgentRuns runs={agentRuns} when={when} /> : null}

      <section aria-labelledby="turns" className="flex flex-col gap-3">
        <h2 id="turns" className="text-heading-lg">
          Turns
        </h2>
        <p className="text-text-secondary text-body">
          In the order they ran, the subagents&apos; among them. Open one for
          what it consumed and what each quantity cost.
        </p>
        <div className="border-rule bg-surface rounded-md border p-2">
          <TurnRows
            turns={page.turns}
            timezone={viewer.orgTimezone}
            showSession={false}
            empty="No Turns are readable for this session."
          />
        </div>
        {page.more && last ? (
          <p>
            <Link
              href={`/sessions/${encodeURIComponent(session.sessionId)}?member=${member}&after=${last.occurredAt},${last.id}`}
              className="text-accent-text underline"
            >
              Later Turns
            </Link>
          </p>
        ) : null}
      </section>
    </div>
  )
}

/** The Project, by the name it has been given or by its key (ticket 90). */
const project = (session: SessionRow) =>
  session.projectName ?? session.projectKey

/** The person, by the name they set for themselves or by their address
 * (ticket 91). Both, when they set one: an address identifies and a name
 * labels, and this page is where somebody asks "whose session was that". */
const person = (session: SessionRow) =>
  session.memberName
    ? `${session.memberName} (${session.memberEmail ?? 'address hidden'})`
    : (session.memberEmail ?? 'Outside your view')

/**
 * Tickets 89 and 94: what this Session spent, per model, and where the tokens
 * went.
 *
 * Between the four tiles above and the Turn list below there was nothing, so
 * "what did the Opus part cost" meant reading four hundred rows. These rows
 * are the same aggregate as the tiles with one more column in the `group by`,
 * so they sum to the figures above them rather than to something near them.
 *
 * Ticket 94 splits the token total into the four reported classes, because
 * the total answered "how much" and never "why" — and the why is almost
 * always the cache. The four are the reported classes and no more: the 5m and
 * 1h splits are subsets of cache creation, and a column each beside it would
 * count a token twice on any reader's mental sum.
 *
 * A model with nothing priced shows an em dash and says how many Turns are
 * behind it — never `$0.00`, which is the confident wrong number ADR 0002 is
 * about.
 *
 * A real table, which the rest of this page is not. Six figures per model do
 * not stack into anything readable at 390px, and a card of six labelled
 * numbers is what a reader comparing models is trying to get away from. So it
 * scrolls sideways on a phone instead, with the model column first: what
 * leaves the viewport is the figures, never the row's identity.
 */
function Models({ models }: { models: SessionModel[] }) {
  if (models.length === 0) return null

  return (
    <section aria-labelledby="models" className="flex flex-col gap-3">
      <h2 id="models" className="text-heading-lg">
        Models
      </h2>
      <div className="border-rule bg-surface overflow-x-auto rounded-md border">
        <table className="w-full min-w-[40rem] border-collapse text-caption">
          <thead>
            <tr className="border-rule text-text-muted border-b text-left">
              <th scope="col" className="p-3 font-normal">
                Model
              </th>
              {NUMERIC.map((column) => (
                <th
                  key={column}
                  scope="col"
                  className="p-3 text-right font-normal"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-rule divide-y">
            {models.map((model) => (
              <tr key={model.model ?? 'none'}>
                <th scope="row" className="p-3 text-left font-normal align-top">
                  <span className="font-mono break-all">
                    {model.model ?? 'No model reported'}
                  </span>
                  <span className="text-text-muted block">
                    {count.format(model.turns)}{' '}
                    {model.turns === 1 ? 'Turn' : 'Turns'}
                  </span>
                </th>
                {cell(model.inputTokens)}
                {cell(model.outputTokens)}
                {cell(model.cacheReadTokens)}
                {cell(model.cacheWriteTokens)}
                <td className="p-3 text-right align-top">
                  <span className="font-mono">{usd(model.costUsd)}</span>
                  <span className="text-text-muted block">
                    {model.unpricedTurns === 0
                      ? 'every Turn has a Rate'
                      : model.costUsd === null
                        ? `${model.unpricedTurns} Turns, no Rate`
                        : `at least: ${model.unpricedTurns} unpriced`}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/** The columns after the model, in the order ticket 94 asks for them. */
const NUMERIC = [
  'Input',
  'Output',
  'Cache read',
  'Cache write',
  'Cost',
] as const

/**
 * One token figure. `compact` for the same reason the tiles use it — these are
 * millions, and a reader comparing two models is comparing magnitudes rather
 * than reconciling a ledger.
 */
const cell = (tokens: number) => (
  <td className="p-3 text-right align-top font-mono">
    {compact.format(tokens)}
  </td>
)

/** The figures the ticket asks for, in the order it asks for them. */
function Summary({
  session,
  when,
}: {
  session: SessionRow
  when: Intl.DateTimeFormat
}) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Tile label="Cost" value={usd(session.costUsd)}>
        {session.costUsd === null
          ? 'nothing priced yet'
          : session.unpricedTurns > 0
            ? `${session.unpricedTurns} Turns unpriced`
            : 'every Turn has a Rate'}
      </Tile>
      <Tile label="Tokens" value={compact.format(session.tokens)}>
        input, output and cache
      </Tile>
      <Tile label="Turns" value={count.format(session.turns)}>
        {session.agentRuns > 0
          ? `${session.agentRuns} subagent ${
              session.agentRuns === 1 ? 'run' : 'runs'
            } inside`
          : 'no subagents'}
      </Tile>
      {!session.endedAt && session.cloud ? (
        // Ticket 95: a cloud container never runs `SessionEnd`, archived or
        // reclaimed, so the tile names the last Turn as the last Turn rather
        // than leaving a blank that reads as a fault.
        <Tile
          label="Last Turn"
          value={when.format(new Date(session.lastTurnAt))}
        >
          cloud sessions report no end
        </Tile>
      ) : (
        <Tile
          label="Ended"
          value={session.endedAt ? when.format(new Date(session.endedAt)) : '—'}
          quiet={!session.endedAt}
        >
          {/* Ticket 05: `SessionEnd` fires about 180ms after SIGTERM and never
              under SIGKILL, so a missing marker is a killed or still-running
              session rather than a fault. Said, not filled in. */}
          {session.endedAt
            ? `started ${when.format(new Date(session.startedAt))}`
            : 'no end marker — killed, or still running'}
        </Tile>
      )}
    </dl>
  )
}

function Tile({
  label,
  value,
  quiet,
  children,
}: {
  label: string
  value: string
  quiet?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="border-rule bg-surface rounded-md border p-4">
      <dt className="text-label text-text-muted uppercase">{label}</dt>
      <dd
        className={`mt-1 font-mono text-figure ${quiet ? 'text-text-muted' : ''}`}
      >
        {value}
      </dd>
      <dd className="text-text-muted mt-1 text-caption">{children}</dd>
    </div>
  )
}

/**
 * The Agent Runs, grouped under the Session they reported against.
 *
 * Finding 74: a subagent writes its own transcript under the parent's session
 * id with an `agent_id` of its own, so these are a grouping of the Turns
 * already listed below rather than a second set of rows. The counts here and
 * the Turn list are two views of the same Turns, which is why the Session's
 * own Turn count covers both.
 */
function AgentRuns({
  runs,
  when,
}: {
  runs: AgentRun[]
  when: Intl.DateTimeFormat
}) {
  return (
    <section aria-labelledby="agents" className="flex flex-col gap-3">
      <h2 id="agents" className="text-heading-lg">
        Subagents
      </h2>
      <ul className="border-rule bg-surface divide-rule divide-y rounded-md border">
        {runs.map((run) => (
          <li
            key={run.agentId}
            className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 p-4"
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="font-mono text-body break-all">
                {run.agentId}
              </span>
              <span className="text-text-muted text-caption">
                {when.format(new Date(run.startedAt))} ·{' '}
                {count.format(run.turns)} {run.turns === 1 ? 'Turn' : 'Turns'} ·{' '}
                {compact.format(run.tokens)} tokens
                {run.spawnDepth === null ? '' : ` · depth ${run.spawnDepth}`}
                {run.unpricedTurns > 0
                  ? ` · ${run.unpricedTurns} unpriced`
                  : ''}
              </span>
            </span>
            <span className="font-mono text-body">{usd(run.costUsd)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * The transcript, or why there is none.
 *
 * Ticket 86 is explicit that an absent transcript is shown with its reason
 * rather than hidden, "an absent link reads as a bug". Archival is opt-in per
 * Member and off by default (ADR 0005), so no transcript is the ordinary case
 * and saying which case it is costs one row.
 */
function Transcripts({
  transcripts,
  archival,
  agentRuns,
}: {
  transcripts: StoredTranscript[]
  archival: 'off' | 'excluded' | 'on' | null
  agentRuns: number
}) {
  return (
    <section aria-labelledby="transcript" className="flex flex-col gap-3">
      <h2 id="transcript" className="text-heading-lg">
        Transcript
      </h2>

      {transcripts.length === 0 ? (
        <p className="border-rule text-text-muted rounded border border-dashed p-4 text-body">
          {archival === 'off'
            ? 'No transcript was stored. Archival is off for this person — it is theirs to turn on, and nobody else in the Org can do it for them.'
            : archival === 'excluded'
              ? 'No transcript was stored. This Project is excluded from archival for this person.'
              : archival === 'on'
                ? // Deliberately a list rather than a diagnosis. The exception
                  // list is the Member's own to read (ADR 0005), so an Admin
                  // looking at somebody else's Session cannot tell an excluded
                  // Project from an unexcluded one — and a page that said "so
                  // it should have uploaded" would be asserting something the
                  // policies deny it.
                  'No transcript was stored. This person’s archival switch is on, so: the session may still be running, it may have been killed before it uploaded, this Project may be excluded from their archival, or the transcript has aged out under Retention.'
                : 'No transcript was stored, and this person’s archival setting is not yours to read.'}
        </p>
      ) : (
        <ul className="border-rule bg-surface divide-rule divide-y rounded-md border">
          {transcripts.map((transcript) => (
            <li
              key={transcript.id}
              className="flex flex-wrap items-center justify-between gap-3 p-4"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-body">
                  {transcript.agentId
                    ? `Subagent ${transcript.agentId}`
                    : 'The session'}
                </span>
                <span className="text-text-muted text-caption">
                  {size(transcript.bytes)}
                </span>
              </span>
              {/* A plain link, because a download is a GET: bookmarkable,
                  retryable, and the route redirects to storage so the bytes
                  never come through the application (ticket 60). A new tab,
                  because every failure of that route answers with plain text
                  rather than a page. */}
              <a
                href={`/api/logs/download/${transcript.id}`}
                target="_blank"
                rel="noopener"
                className="hover:text-accent-text text-body underline"
              >
                Download
              </a>
            </li>
          ))}
        </ul>
      )}

      {transcripts.length > 0 && agentRuns >= transcripts.length ? (
        <p className="text-text-muted text-caption">
          A subagent writes its own transcript under the same session id
          (finding 74), so a run with no row here uploaded nothing.
        </p>
      ) : null}
    </section>
  )
}

/**
 * The archival reason, asked for only when it is going to be used.
 *
 * It needs the Session's Project id, which the summary does not carry — the
 * row names the Project by key. One extra statement, and only on this page.
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
