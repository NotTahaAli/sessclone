import Link from 'next/link'

import { StoredTranscripts } from './stored-transcripts'
import { PageHeader } from '../page-header'
import { listArchivalMemberships } from '../../../lib/archival'
import {
  storedProjects,
  storedSessions,
  type StoredProject,
} from '../../../lib/artifacts'
import { asViewer } from '../../../lib/db'
import { currentViewer, reachesTeamTranscripts } from '../../../lib/viewer'

// Ticket 87: the transcripts, out of settings.
//
// They were in two places and neither was findable. Ticket 84 put the Org's
// at `/settings/transcripts` and ticket 59's opt-in put a Member's own on
// `/settings/you`. Both are things a person comes *looking for* — a transcript
// is evidence, wanted at the moment somebody asks what a session actually did
// — and settings is where a person goes to change something, not to find
// something. So one destination, with the two listings behind it.
//
// What stayed behind is the archival switch itself, on Your settings. That is
// a change to make rather than a thing to find, which is the line this ticket
// draws.
//
// Delete did not move and did not widen. `log_artifacts_delete` is
// `sessclone_own_member_ids()` (ADR 0005), so a transcript is the Member's own
// to destroy: the team listing has Download and no Delete, exactly as ticket
// 84 built it. An Admin may read a Member's transcript and may not remove it.
//
// The Role check below is navigation and not authorisation. What a Manager
// actually sees is whatever `sessclone_visible_member_ids()` returns for them
// (ADR 0001) — their Scope and nothing else — so with an empty Scope the team
// section is empty rather than refused.

export default async function Transcripts({
  searchParams,
}: {
  searchParams: Promise<{ member?: string; project?: string; before?: string }>
}) {
  const viewer = await currentViewer()
  if (!viewer) return null

  const params = await searchParams
  const team = reachesTeamTranscripts(viewer.role)

  // One group of somebody else's, opened from the list below. Only a viewer
  // whose Role reaches the team listing can ask for one; for anybody else the
  // parameter is ignored rather than refused, since their own rows are what
  // this page is and a 404 would be a worse answer to a stale link.
  // Two scalars rather than one object, so nothing builds a fresh object to
  // hand down: `none` is the Sessions that ran outside a repository — a group
  // rather than a gap, and the spelling every surface here uses.
  const opened = team ? params.member : undefined
  if (opened)
    return (
      <Group
        memberId={opened}
        projectId={
          !params.project || params.project === 'none' ? null : params.project
        }
        before={params.before}
      />
    )

  const [memberships, mine, mySessions, theirs] = await asViewer(
    viewer.userId,
    (tx) =>
      Promise.all([
        listArchivalMemberships(tx),
        storedProjects(tx),
        storedSessions(tx),
        team ? storedProjects(tx, { audience: 'team' }) : null,
      ]),
  )

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Transcripts"
        description="The session transcripts that have been archived, yours and — where your Role reaches them — your team’s."
      />

      <section aria-labelledby="yours">
        <h2 id="yours" className="text-heading-lg">
          Yours
        </h2>
        <p className="text-text-secondary mt-2 text-sm">
          What has already been uploaded from your machines. Deleting one
          destroys the transcript itself, not the session&apos;s usage or cost —
          those are always reported. This cannot be undone.{' '}
          <Link href="/settings/you" className="text-accent-text underline">
            Archival is a setting
          </Link>
          , and it is off until you turn it on.
        </p>

        <StoredTranscripts
          projects={mine.projects}
          sessions={mySessions.sessions}
          // Either cap being reached means the page is not the whole picture.
          more={mySessions.more || mine.more}
          heading={false}
          timezone={viewer.orgTimezone}
          // Named only when there is more than one Org to tell apart, as the
          // archival section on Your settings names them only then.
          orgNames={
            new Map(
              memberships.length > 1
                ? memberships.map((membership) => [
                    membership.member_id,
                    membership.org_name,
                  ])
                : [],
            )
          }
        />
      </section>

      {theirs ? (
        <Team
          projects={theirs.projects}
          more={theirs.more}
          timezone={viewer.orgTimezone}
        />
      ) : null}
    </div>
  )
}

/**
 * The team's transcripts, as a list of groups rather than a flat feed.
 *
 * Ticket 84's reasoning, unchanged by the move: the index the Session list
 * needs is `(member_id, uploaded_at desc, id desc)`, and across a whole Org
 * the id set has many Members in it — so an Org-wide feed is a sort over every
 * artifact the Org has ever stored, and a truncated one at that. The groups
 * are the unit, and each opens its own Sessions by equality on one Member.
 */
function Team({
  projects,
  more,
  timezone,
}: {
  projects: StoredProject[]
  more: boolean
  timezone: string
}) {
  const stamp = when(timezone)

  return (
    <section aria-labelledby="team" className="mt-8">
      <h2 id="team" className="text-heading-lg">
        Your team&apos;s
      </h2>
      <p className="text-text-secondary mt-2 text-sm">
        Transcripts stored by the people you can see. A transcript is the
        Member&apos;s own to delete, so these can be read and not removed from
        here.
      </p>

      {projects.length === 0 ? (
        <p className="border-rule text-text-muted mt-4 rounded border border-dashed p-6 text-sm">
          Nothing stored. A transcript appears here once a Member turns archival
          on and one of their sessions has finished.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {projects.map((project) => (
            <li key={groupKey(project)}>
              <Link
                href={`/transcripts?${new URLSearchParams({
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
                  {stamp.format(project.newest)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {more ? (
        <p className="text-text-muted mt-4 text-sm">
          The {projects.length} most recently used projects are listed.
        </p>
      ) : null}
    </section>
  )
}

/** One Member's Project, opened from the team list. Ticket 84's second view. */
async function Group({
  memberId,
  projectId,
  before,
}: {
  memberId: string
  projectId: string | null
  before: string | undefined
}) {
  const viewer = await currentViewer()
  if (!viewer) return null

  const group = { memberId, projectId }

  const [{ projects }, { sessions, more }] = await asViewer(
    viewer.userId,
    (tx) =>
      Promise.all([
        // The group's own summary, which is also what refuses a hand-typed
        // member id: a group the viewer may not see comes back empty, and the
        // policy decided that rather than anything on this page.
        storedProjects(tx, { audience: 'team', group, limit: 1 }),
        storedSessions(tx, {
          audience: 'team',
          group,
          before: cursorOf(before),
        }),
      ]),
  )

  const listed = projects[0]
  if (!listed) {
    return (
      <div className="flex max-w-3xl flex-col gap-6">
        <PageHeader title="Nothing stored" />
        <p className="text-text-secondary text-body">
          There is no stored transcript here, or it is not yours to read.{' '}
          <Link href="/transcripts" className="text-accent-text underline">
            All transcripts
          </Link>
        </p>
      </div>
    )
  }

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
        timezone={viewer.orgTimezone}
        orgNames={EMPTY_NAMES}
      />

      <div className="flex gap-4 text-sm">
        <Link href="/transcripts" className="underline">
          All transcripts
        </Link>
        {more && last ? (
          <Link
            href={`/transcripts?${new URLSearchParams({
              member: memberId,
              project: projectId ?? 'none',
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

/** As in `stored-transcripts.tsx`: to the minute, in the Org's timezone. */
const when = (timezone: string) =>
  new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  })

/** One empty map, rather than a new one on every render of a group. */
const EMPTY_NAMES = new Map<string, string>()

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
