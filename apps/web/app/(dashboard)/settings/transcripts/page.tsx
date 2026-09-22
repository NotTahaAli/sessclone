import Link from 'next/link'
import { notFound } from 'next/navigation'

import {
  storedProjects,
  storedSessions,
  type StoredProject,
} from '../../../../lib/artifacts'
import { StoredTranscripts } from '../you/stored-transcripts'
import { PageHeader } from '../../page-header'
import { asViewer } from '../../../../lib/db'
import { currentViewer, reachesTeamTranscripts } from '../../../../lib/viewer'

// Ticket 84: the Org-side listing of stored transcripts.
//
// Ticket 60 built the download and `log_artifacts_read` already answers it for
// every Role entitled to a transcript — an Owner or Admin for any Member, a
// Manager for their Scope. What was missing was a surface: the only listing
// was a Member's own, so another Member's transcript was reachable by its id
// and browsable by nobody.
//
// Two views, and the reason is both completeness and the query plan. The
// index the Session list needs is `(member_id, uploaded_at desc, id desc)`,
// and across a whole Org the id set has many Members in it, so the ordering
// cannot come from it — a flat Org-wide feed is a sort over every artifact the
// Org has ever stored, and a truncated one at that, which on a read-only page
// is a dead end rather than a summary. So this page lists the groups, and a
// group opens its own Sessions by equality on one Member, paged by a cursor.
//
// Read-only on purpose, and that is ADR 0005 rather than a simplification:
// `log_artifacts_delete` is `sessclone_own_member_ids()`, so a transcript is
// the Member's own to destroy. An Admin may read one and may not remove it,
// and this page therefore renders no Delete control at all.
//
// The Role check here is navigation, not authorisation: what a Manager
// actually sees is whatever `sessclone_visible_member_ids()` returns for them
// (ADR 0001), which is their Scope and nothing else — with an empty Scope this
// page is empty rather than refused.

export default async function TeamTranscripts({
  searchParams,
}: {
  searchParams: Promise<{ member?: string; project?: string; before?: string }>
}) {
  const viewer = await currentViewer()
  if (!viewer || !reachesTeamTranscripts(viewer.role)) notFound()

  const params = await searchParams
  const group = params.member
    ? {
        memberId: params.member,
        // `none` is the Sessions that ran outside a repository — a group
        // rather than a gap, and the same spelling the Member's own page uses.
        projectId:
          !params.project || params.project === 'none' ? null : params.project,
      }
    : undefined

  // A cursor rather than an offset: `(uploaded_at, id)`, because a page
  // boundary that repeats or skips a row is worse than no paging. Anything
  // unparseable is treated as no cursor, which shows the first page rather
  // than an error.
  const before = cursorOf(params.before)

  if (!group) {
    const { projects, more } = await asViewer(viewer.userId, (tx) =>
      storedProjects(tx, { audience: 'team' }),
    )

    return (
      <div className="flex max-w-3xl flex-col gap-6">
        <PageHeader
          title="Team transcripts"
          description="Transcripts stored by the people you can see. A transcript is the Member’s own to delete, so these can be read and not removed from here."
        />

        {projects.length === 0 ? (
          <p className="border-rule text-text-muted rounded border border-dashed p-6 text-sm">
            Nothing stored. A transcript appears here once a Member turns
            archival on and one of their sessions has finished.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {projects.map((project) => (
              <li key={groupKey(project)}>
                <Link
                  href={`/settings/transcripts?${new URLSearchParams({
                    member: project.memberId,
                    project: project.projectId ?? 'none',
                  })}`}
                  className="border-rule bg-surface hover:bg-surface-hover block rounded-md border p-4"
                >
                  <p
                    className={
                      project.projectKey
                        ? 'font-mono text-sm break-all'
                        : 'text-sm italic'
                    }
                  >
                    {name(project)}
                  </p>
                  <p className="text-text-muted mt-1 text-sm">
                    {project.memberEmail ?? 'A Member'} ·{' '}
                    {project.orgName ? `${project.orgName} · ` : ''}
                    {project.sessions} session
                    {project.sessions === 1 ? '' : 's'} ·{' '}
                    {DAY.format(project.newest)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {more ? (
          <p className="text-text-muted text-sm">
            The {projects.length} most recently used projects are listed.
          </p>
        ) : null}
      </div>
    )
  }

  const [{ projects }, { sessions, more }] = await asViewer(
    viewer.userId,
    (tx) =>
      Promise.all([
        // The group's own summary, which is also what refuses a hand-typed
        // member id: a group the viewer may not see comes back empty, and the
        // policy is what decided that rather than anything on this page.
        storedProjects(tx, { audience: 'team', group, limit: 1 }),
        storedSessions(tx, { audience: 'team', group, before }),
      ]),
  )

  const listed = projects[0]
  if (!listed) notFound()

  const last = sessions.at(-1)

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title={name(listed)}
        description={`${listed.memberEmail ?? 'A Member'}${
          listed.orgName ? ` · ${listed.orgName}` : ''
        } · ${listed.sessions} stored session${
          listed.sessions === 1 ? '' : 's'
        }. A transcript is the Member’s own to delete, so these can be read and not removed from here.`}
      />

      <StoredTranscripts
        projects={projects}
        sessions={sessions}
        more={false}
        audience="team"
        orgNames={new Map()}
      />

      <div className="flex gap-4 text-sm">
        <Link href="/settings/transcripts" className="underline">
          All projects
        </Link>
        {more && last ? (
          <Link
            href={`/settings/transcripts?${new URLSearchParams({
              member: group.memberId,
              project: group.projectId ?? 'none',
              before: `${last.uploadedAt.toISOString()},${last.id}`,
            })}`}
            className="underline"
          >
            Older sessions
          </Link>
        ) : null}
      </div>
    </div>
  )
}

const DAY = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' })

const name = (project: StoredProject) =>
  project.projectKey ?? 'Sessions outside a repository'

const groupKey = (project: StoredProject) =>
  `${project.memberId}:${project.projectId ?? 'none'}`

/** `<iso>,<uuid>`, or nothing. Anything else is no cursor. */
const cursorOf = (value: string | undefined) => {
  const [at, id] = value?.split(',') ?? []
  if (!at || !id) return undefined
  const uploadedAt = new Date(at)
  return Number.isNaN(uploadedAt.getTime()) ? undefined : { uploadedAt, id }
}
