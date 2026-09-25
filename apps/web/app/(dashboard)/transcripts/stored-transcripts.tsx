import { deleteProject, deleteSession } from './artifact-actions'
import { DownloadTranscript } from '../sessions/[sessionId]/transcript/download'
import { Row, SectionBreak } from '../../_ui/primitives'
import type { StoredProject, StoredSession } from '../../../lib/artifacts'

// Ticket 73's surface. ADR 0005 keeps it apart from the archival switch on
// purpose: stopping collection and destroying what is held are different
// intentions and must not share a click.
//
// Both deletes are inside a `details` rather than firing on first press. A
// deletion cannot be undone, and a one-press destructive control is a mis-tap
// away from a year of transcripts. The disclosure is native HTML, so the
// confirmation costs no client JavaScript and works with it turned off.
//
// Direction A (ticket 112): each Project is a section break with its figures,
// and each stored session a row under it — no box per Project.

const BYTES = ['bytes', 'KB', 'MB', 'GB', 'TB']

/** Three significant figures is what a person reads off a size. */
const size = (bytes: number) => {
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < BYTES.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${unit === 0 ? value : value.toFixed(value < 10 ? 1 : 0)} ${BYTES[unit]}`
}

/**
 * A time on this page, to the minute and in the Org's timezone.
 *
 * The date alone was not enough (Taha, 2026-09-22): several sessions on one
 * repository land on the same day, and a column of identical dates cannot say
 * which of them is the one somebody just asked about.
 */
const when = (timezone: string) =>
  new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  })

/** One shared empty list, so a Project with no listed Session is not a new array. */
const EMPTY: StoredSession[] = []

/**
 * A membership and one of its Projects, as one key. `none` is the Sessions
 * that ran outside a repository, which is a group rather than a gap — and the
 * same spelling the delete form posts.
 */
const groupKey = (memberId: string, projectId: string | null) =>
  `${memberId}:${projectId ?? 'none'}`

const LINK = 'text-text-muted hover:text-text underline'

export function StoredTranscripts({
  projects,
  sessions,
  more,
  orgNames,
  audience = 'own',
  timezone,
}: {
  projects: StoredProject[]
  sessions: StoredSession[]
  more: boolean
  /** Member id to Org name, and empty when the viewer is in one Org. */
  orgNames: Map<string, string>
  /**
   * Whose transcripts these are (ticket 84). A `team` listing names the
   * Member each group belongs to and carries no Delete control at all:
   * `log_artifacts_delete` is the Member's own rows alone (ADR 0005), so a
   * button an Admin can see and never use is a button that lies.
   */
  audience?: 'own' | 'team'
  /** The Org's timezone, so an upload time reads in the same zone as every
   * other figure on the dashboard. */
  timezone: string
}) {
  const own = audience === 'own'
  const stamp = when(timezone)
  // Grouped once rather than filtered per Project, which would be a pass over
  // every Session per group — and a new array in a prop on every render.
  const byGroup = new Map<string, StoredSession[]>()
  for (const session of sessions) {
    const key = groupKey(session.memberId, session.projectId)
    let group = byGroup.get(key)
    if (!group) byGroup.set(key, (group = []))
    group.push(session)
  }

  return (
    <section aria-label="Stored transcripts">
      {projects.length === 0 ? (
        <p className="text-text-muted py-3 text-body">
          {own
            ? 'Nothing stored. Transcripts appear here once archival is on and a session has finished.'
            : 'Nothing stored. A transcript appears here once a Member turns archival on and one of their sessions has finished.'}
        </p>
      ) : (
        projects.map((project) => (
          <Group
            key={groupKey(project.memberId, project.projectId)}
            project={project}
            own={own}
            orgName={orgNames.get(project.memberId)}
            stamp={stamp}
            sessions={
              byGroup.get(groupKey(project.memberId, project.projectId)) ??
              EMPTY
            }
          />
        ))
      )}

      {more ? (
        <p className="text-text-muted mt-4 text-caption">
          {own
            ? 'Only your most recent sessions are listed. Deleting a whole project covers every session in it, listed or not.'
            : 'Only the most recent sessions are listed. The counts above each project cover every session in it, listed or not.'}
        </p>
      ) : null}
    </section>
  )
}

function Group({
  project,
  sessions,
  orgName,
  own,
  stamp,
}: {
  project: StoredProject
  sessions: StoredSession[]
  orgName: string | undefined
  own: boolean
  stamp: Intl.DateTimeFormat
}) {
  const name = project.projectKey ?? 'Sessions outside a repository'

  return (
    <div>
      <SectionBreak as="h3">
        <span className={project.projectKey ? 'font-mono' : ''}>{name}</span>
      </SectionBreak>
      <p className="text-text-muted flex flex-wrap items-baseline justify-between gap-x-3 text-caption">
        <span>
          {own ? '' : `${project.memberEmail ?? 'A Member'} · `}
          {project.sessions} session{project.sessions === 1 ? '' : 's'} ·{' '}
          {size(project.bytes)} · last upload {stamp.format(project.newest)}
          {orgName ? ` · ${orgName}` : ''}
        </span>
        {own ? (
          <Confirm
            summary="Delete all"
            // Named rather than counted in the button: the count is beside
            // it, and a button that says what it destroys is what a person
            // reads before pressing.
            question={`Delete all ${project.sessions} transcript${
              project.sessions === 1 ? '' : 's'
            } stored for ${name}? This cannot be undone.`}
            action={deleteProject}
            label={`Delete every stored transcript for ${name}`}
            memberId={project.memberId}
            projectId={project.projectId ?? 'none'}
          />
        ) : null}
      </p>

      {sessions.length === 0 ? null : (
        <ol className="mt-1">
          {sessions.map((session) => (
            <li key={session.id}>
              <Row
                lead="none"
                meta={size(session.bytes)}
                // The last message rather than the upload (Taha,
                // 2026-09-22): a laptop that was closed uploads hours after
                // the work everybody remembers. Where no Turn is readable
                // there is nothing to say but when it arrived.
                sub={
                  session.lastTurnAt
                    ? `last message ${stamp.format(session.lastTurnAt)}`
                    : `uploaded ${stamp.format(session.uploadedAt)}`
                }
              >
                <span className="font-mono">
                  {session.sessionId}
                  {session.agentId ? ` · subagent ${session.agentId}` : ''}
                </span>
              </Row>
              <div className="-mt-1 flex flex-wrap items-start gap-3 pb-1.5 pl-[22px] text-caption">
                {session.agentId ? null : (
                  <a
                    href={`/sessions/${encodeURIComponent(session.sessionId)}/transcript?member=${session.memberId}`}
                    className="underline"
                  >
                    View
                  </a>
                )}
                {/* Ticket 60. A plain link, because a download is a GET, and
                    the route redirects to storage so the bytes never come
                    through the application. A new tab, because every failure
                    of the route answers with plain text rather than a page. */}
                {session.chunked ? (
                  // Ticket 133: sealed chunks plus a tail, assembled in the
                  // browser into one .jsonl.
                  <DownloadTranscript
                    sessionId={session.sessionId}
                    memberId={session.memberId}
                    agentId={session.agentId}
                    className={LINK}
                    label={`Download the transcript of session ${session.sessionId}`}
                  />
                ) : (
                  <a
                    href={`/api/logs/download/${session.id}`}
                    target="_blank"
                    rel="noopener"
                    className={LINK}
                    aria-label={`Download the transcript of session ${session.sessionId}`}
                  >
                    Download
                  </a>
                )}
                {own ? (
                  <Confirm
                    summary="Delete"
                    question={`Delete the transcript of session ${session.sessionId}? This cannot be undone.`}
                    action={deleteSession}
                    label={`Delete the transcript of session ${session.sessionId}`}
                    artifactId={session.id}
                  />
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/**
 * A destructive button behind a native disclosure: press once to see what it
 * will destroy, press the second to destroy it. No client JavaScript, so it
 * behaves the same on a phone with a slow connection as on a warm page.
 */
function Confirm({
  summary,
  question,
  action,
  label,
  memberId,
  projectId,
  artifactId,
}: {
  summary: string
  question: string
  action: (formData: FormData) => void
  label: string
  memberId?: string
  projectId?: string
  artifactId?: string
}) {
  return (
    <details className="min-w-0">
      <summary className={`${LINK} cursor-pointer list-none`}>
        {summary}
        <span className="sr-only"> {label}</span>
      </summary>

      <form action={action} className="mt-1.5 max-w-xs">
        {memberId ? (
          <input type="hidden" name="memberId" value={memberId} />
        ) : null}
        {projectId ? (
          <input type="hidden" name="projectId" value={projectId} />
        ) : null}
        {artifactId ? (
          <input type="hidden" name="artifactId" value={artifactId} />
        ) : null}
        <p className="text-text-secondary text-caption">{question}</p>
        <button
          type="submit"
          className="border-bad-border text-bad-text mt-1.5 inline-flex h-[var(--pill-h)] items-center rounded-full border px-3 text-[13px]"
        >
          Delete permanently
          <span className="sr-only"> — {label}</span>
        </button>
      </form>
    </details>
  )
}
