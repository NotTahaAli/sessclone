import { deleteProject, deleteSession } from './artifact-actions'
import type { StoredProject, StoredSession } from '../../../../lib/artifacts'

// Ticket 73's surface. ADR 0005 keeps it apart from the archival switch above
// on purpose: stopping collection and destroying what is held are different
// intentions and must not share a click. So this is its own section, with its
// own heading, below the switch rather than inside it.
//
// Both buttons are inside a `details` rather than firing on first press. A
// deletion cannot be undone, and a one-press destructive control sitting in a
// settings page is a mis-tap away from a year of transcripts. The disclosure
// is native HTML, so the confirmation costs no client JavaScript and works
// with it turned off — as every other control on this page does.

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

const DAY = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' })

/** One shared empty list, so a Project with no listed Session is not a new array. */
const EMPTY: StoredSession[] = []

/**
 * A membership and one of its Projects, as one key. `none` is the Sessions
 * that ran outside a repository, which is a group rather than a gap — and the
 * same spelling the delete form posts.
 */
const groupKey = (memberId: string, projectId: string | null) =>
  `${memberId}:${projectId ?? 'none'}`

export function StoredTranscripts({
  projects,
  sessions,
  more,
  orgNames,
}: {
  projects: StoredProject[]
  sessions: StoredSession[]
  more: boolean
  /** Member id to Org name, and empty when the viewer is in one Org. */
  orgNames: Map<string, string>
}) {
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
    <section aria-labelledby="stored" className="mt-8">
      <h2 id="stored" className="text-heading-lg">
        Stored transcripts
      </h2>
      <p className="text-text-secondary mt-2 text-sm">
        What has already been uploaded. Deleting one destroys the transcript
        itself, not the session&apos;s usage or cost — those are always
        reported. This cannot be undone.
      </p>

      {projects.length === 0 ? (
        <p className="border-rule text-text-muted mt-4 rounded border border-dashed p-6 text-sm">
          Nothing stored. Transcripts appear here once archival is on and a
          session has finished.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-4">
          {projects.map((project) => (
            <li
              key={groupKey(project.memberId, project.projectId)}
              className="border-rule rounded border p-4"
            >
              <Group
                project={project}
                orgName={orgNames.get(project.memberId)}
                sessions={
                  byGroup.get(groupKey(project.memberId, project.projectId)) ??
                  EMPTY
                }
              />
            </li>
          ))}
        </ul>
      )}

      {more ? (
        <p className="text-text-muted mt-4 text-sm">
          Only your most recent sessions are listed. Deleting a whole project
          covers every session in it, listed or not.
        </p>
      ) : null}
    </section>
  )
}

function Group({
  project,
  sessions,
  orgName,
}: {
  project: StoredProject
  sessions: StoredSession[]
  orgName: string | undefined
}) {
  const name = project.projectKey ?? 'Sessions outside a repository'

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p
            className={
              project.projectKey
                ? 'font-mono text-sm break-all'
                : 'text-sm italic'
            }
          >
            {name}
          </p>
          <p className="text-text-muted mt-1 text-sm">
            {project.sessions} session{project.sessions === 1 ? '' : 's'} ·{' '}
            {size(project.bytes)} · newest {DAY.format(project.newest)}
            {orgName ? ` · ${orgName}` : ''}
          </p>
        </div>

        <Confirm
          summary="Delete all"
          // Named rather than counted in the button: the count is above it,
          // and a button that says what it destroys is what a person reads
          // before pressing.
          question={`Delete all ${project.sessions} transcript${
            project.sessions === 1 ? '' : 's'
          } stored for ${name}? This cannot be undone.`}
          action={deleteProject}
          label={`Delete every stored transcript for ${name}`}
          memberId={project.memberId}
          projectId={project.projectId ?? 'none'}
        />
      </div>

      {sessions.length === 0 ? null : (
        <ul className="mt-3">
          {sessions.map((session) => (
            <li
              key={session.id}
              className="border-rule flex flex-wrap items-center justify-between gap-3 border-t py-2"
            >
              <div className="min-w-0">
                <p className="font-mono text-sm break-all">
                  {session.sessionId}
                  {session.agentId ? ` · subagent ${session.agentId}` : ''}
                </p>
                <p className="text-text-muted text-sm">
                  {size(session.bytes)} · {DAY.format(session.uploadedAt)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {/* Ticket 60. A plain link, because a download is a GET: it
                    can be bookmarked, retried and handed to `curl`, and the
                    route redirects to storage so the bytes never come through
                    the application. */}
                <a
                  href={`/api/logs/download/${session.id}`}
                  className="hover:text-accent-text text-sm underline"
                  aria-label={`Download the transcript of session ${session.sessionId}`}
                >
                  Download
                </a>
                <Confirm
                  summary="Delete"
                  question={`Delete the transcript of session ${session.sessionId}? This cannot be undone.`}
                  action={deleteSession}
                  label={`Delete the transcript of session ${session.sessionId}`}
                  artifactId={session.id}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
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
      <summary className="border-control-border text-text inline-block cursor-pointer rounded border px-3 py-1 text-sm whitespace-nowrap">
        {summary}
        <span className="sr-only"> {label}</span>
      </summary>

      <form action={action} className="mt-2 max-w-xs">
        {memberId ? (
          <input type="hidden" name="memberId" value={memberId} />
        ) : null}
        {projectId ? (
          <input type="hidden" name="projectId" value={projectId} />
        ) : null}
        {artifactId ? (
          <input type="hidden" name="artifactId" value={artifactId} />
        ) : null}
        <p className="text-text-secondary text-sm">{question}</p>
        <button
          type="submit"
          className="border-bad-border text-bad-text mt-2 rounded border px-3 py-1 text-sm"
        >
          Delete permanently
          <span className="sr-only"> — {label}</span>
        </button>
      </form>
    </details>
  )
}
