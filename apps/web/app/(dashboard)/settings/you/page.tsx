import { setArchival, setProject } from './actions'
import {
  listArchivalMemberships,
  listArchivalProjects,
  type ArchivalMembership,
  type ArchivalProject,
} from '../../../../lib/archival'
import { storedProjects, storedSessions } from '../../../../lib/artifacts'
import { ownScopes, type OwnScope } from '../../../../lib/scopes'
import { StoredTranscripts } from './stored-transcripts'
import { PageHeader } from '../../page-header'
import { asViewer } from '../../../../lib/db'
import { signedInUser } from '../../../../lib/supabase/server'

// Ticket 72: `/settings/you`, the destination `docs/design/product-ia.md`
// gives every Role, carrying the settings that are the Member's own. Archival
// is the first of them, and a Manager's own Scope (ticket 46) is the second;
// appearance (77) and the Member's Log Artifacts (60, 73) land beside them
// later.
//
// ADR 0005 is what this page is the surface of, and its two rules shape every
// control here: the master switch is the Member's own and starts off, and the
// per-Project setting is an opt-out list *inside* it — so a Project with no
// row inherits the switch, and a new repository is archived without a visit.

/** One shared empty list, so a membership with no Projects is not a new array. */
const EMPTY: ArchivalProject[] = []

export default async function YourSettings() {
  const user = await signedInUser()

  // The shell above has already said so for every page under it, so this is
  // narrowing for the type checker rather than a second message.
  if (!user) return null

  // One transaction, which is what `asViewer` opens and what carries the
  // viewer's claim. The two statements are independent, so they go together.
  const [memberships, projects, scopes, stored, sessions] = await asViewer(
    user.id,
    (tx) =>
      Promise.all([
        listArchivalMemberships(tx),
        listArchivalProjects(tx),
        ownScopes(tx),
        storedProjects(tx),
        storedSessions(tx),
      ]),
  )

  // Grouped once here rather than filtered inside the render, which would be
  // a pass over the whole list per membership. One pass, one array each, and
  // each array is pushed into rather than rebuilt.
  const byMember = new Map<string, ArchivalProject[]>()
  for (const project of projects) {
    let group = byMember.get(project.member_id)
    if (!group) byMember.set(project.member_id, (group = []))
    group.push(project)
  }

  return (
    // Capped at a readable measure. Inside `Panel` this page sat in a 3xl
    // column; the shell's content column is 1208px at 1440, which is right for
    // a chart and far past a measure anybody wants to read a paragraph at.
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="Your settings" />

      <YourScopes scopes={scopes} />

      <section aria-labelledby="archival" className="mt-8">
        <h2 id="archival" className="text-heading-lg">
          Transcript archival
        </h2>
        <p className="text-text-secondary mt-2 text-sm">
          Usage and cost are always reported. Archival is separate: it uploads
          the session transcripts themselves, so they can be downloaded and read
          later. It is off until you turn it on, and nobody in your Org can turn
          it on for you.
        </p>

        <BeforeYouOptIn />

        {memberships.length === 0 ? (
          <p className="border-rule text-text-muted mt-6 rounded border border-dashed p-6 text-sm">
            You are not a Member of an Org yet, so there is nothing to archive.
          </p>
        ) : (
          memberships.map((membership) => (
            <OrgArchival
              key={membership.member_id}
              membership={membership}
              projects={byMember.get(membership.member_id) ?? EMPTY}
              // A person in one Org does not need to be told which Org.
              named={memberships.length > 1}
            />
          ))
        )}
      </section>

      <StoredTranscripts
        projects={stored.projects}
        sessions={sessions.sessions}
        // Either cap being reached means the page is not the whole picture.
        more={sessions.more || stored.more}
        // Named only when there is more than one Org to tell apart, as the
        // archival section above names them only then.
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
    </div>
  )
}

/**
 * What a transcript from a shared environment contains, said before the switch
 * rather than after it (ticket 72, finding 74).
 *
 * The Member's own laptop transcripts are the Member's own work. A Claude
 * Projects session is not: it carries the project's conversation, and
 * everybody else in that project writes into it too. Turning the switch on is
 * therefore a decision about more than your own messages, and somebody who
 * only learns that from the archive has learned it too late.
 */
function BeforeYouOptIn() {
  return (
    <div className="border-warn-border bg-warn-bg mt-4 rounded border p-4 text-sm">
      <h3 className="font-medium">Before you turn this on</h3>
      <p className="text-text-secondary mt-2">
        A transcript holds everything the session saw: your prompts, the
        model&apos;s replies, the files it read and the commands it ran. That
        can include source code and, in a file it happened to open, a
        credential.
      </p>
      <p className="text-text-secondary mt-2">
        From a shared environment it holds more than your own work. In Claude
        Projects a session carries the project&apos;s own conversation, so the
        messages other members wrote there are in the transcript you upload.
      </p>
    </div>
  )
}

function OrgArchival({
  membership,
  projects,
  named,
}: {
  membership: ArchivalMembership
  projects: ArchivalProject[]
  named: boolean
}) {
  const on = membership.archival_enabled

  return (
    <div className="border-rule mt-6 rounded border p-4">
      {named ? (
        <h3 className="text-heading">{membership.org_name}</h3>
      ) : (
        <h3 className="sr-only">{membership.org_name}</h3>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          Archival is <strong>{on ? 'on' : 'off'}</strong>
          {on ? (
            <span className="text-text-secondary">
              {' '}
              — new sessions upload unless you exclude their Project below.
            </span>
          ) : (
            <span className="text-text-secondary">
              {' '}
              — nothing leaves your machines.
            </span>
          )}
        </p>
        <Toggle
          action={setArchival}
          memberId={membership.member_id}
          to={on ? 'off' : 'on'}
          label={on ? 'Turn archival off' : 'Turn archival on'}
        />
      </div>

      {/* ADR 0005: off is forward-only. Two intentions, two actions — stop
          collecting, and destroy what you hold. Said where it is about to be
          acted on, which is beside a switch that is currently on. */}
      {on ? (
        <p className="text-text-muted mt-2 text-sm">
          Turning archival off stops new uploads. It keeps what is already
          stored, which then ages out under your Org&apos;s retention setting.
          Deleting stored transcripts is a separate action.
        </p>
      ) : null}

      <ProjectList membership={membership} projects={projects} />
    </div>
  )
}

/**
 * Every Project the Member has Sessions in, so an exclusion can be made
 * without guessing a key — which matters most for a `local:` key, being a
 * hostname and an absolute path that nobody types correctly from memory.
 */
function ProjectList({
  membership,
  projects,
}: {
  membership: ArchivalMembership
  projects: ArchivalProject[]
}) {
  if (projects.length === 0) {
    return (
      <p className="text-text-muted mt-4 text-sm">
        No Projects yet. One appears here once a Collector reports a session
        from it.
      </p>
    )
  }

  return (
    <>
      <h4 className="text-label text-text-muted mt-6 uppercase">Projects</h4>
      <p className="text-text-secondary mt-2 text-sm">
        A new Project follows the switch above. Exclude the ones that should
        never upload.
      </p>

      <ul className="mt-3">
        {projects.map((project) => {
          // Null is the common case and the important one: no row, so the
          // Project inherits the switch rather than holding a decision.
          const excluded = project.archival_enabled === false

          return (
            <li
              key={project.project_id}
              className="border-rule flex flex-wrap items-center justify-between gap-3 border-b py-3"
            >
              <div className="min-w-0">
                <p className="font-mono text-sm break-all">{project.key}</p>
                <p className="text-text-muted text-sm">
                  {excluded
                    ? 'Excluded — sessions here never upload.'
                    : membership.archival_enabled
                      ? 'Archived.'
                      : 'Would be archived, once the switch is on.'}
                </p>
              </div>
              <Toggle
                action={setProject}
                memberId={membership.member_id}
                projectId={project.project_id}
                to={excluded ? 'on' : 'off'}
                label={
                  excluded ? `Include ${project.key}` : `Exclude ${project.key}`
                }
                short={excluded ? 'Include' : 'Exclude'}
              />
            </li>
          )
        })}
      </ul>
    </>
  )
}

/**
 * One form, one button, one write. A `form` rather than a checkbox because the
 * page is a Server Component: this posts and re-renders without a line of
 * client JavaScript, and works with it turned off.
 *
 * `to` is the state being moved to rather than a toggle, so two presses of a
 * stale page land on the same setting instead of flipping it twice.
 */
function Toggle({
  action,
  memberId,
  projectId,
  to,
  label,
  short,
}: {
  action: (formData: FormData) => void
  memberId: string
  projectId?: string
  to: 'on' | 'off'
  label: string
  short?: string
}) {
  return (
    <form action={action}>
      <input type="hidden" name="memberId" value={memberId} />
      {projectId ? (
        <input type="hidden" name="projectId" value={projectId} />
      ) : null}
      <input type="hidden" name="to" value={to} />
      <button
        type="submit"
        className="border-control-border text-text rounded border px-3 py-1 text-sm whitespace-nowrap"
      >
        {short ? (
          <>
            {short}
            <span className="sr-only"> {label}</span>
          </>
        ) : (
          label
        )}
      </button>
    </form>
  )
}

/**
 * A Manager's own Scope, which is ticket 46's second criterion.
 *
 * It is about trust rather than convenience. A Manager who cannot see their
 * Scope cannot tell a Member they were never given from a Member who has
 * reported nothing, and will read the first as a bug in the product. So the
 * empty case says out loud that it is empty and who changes it, rather than
 * rendering nothing and leaving them to guess.
 *
 * Absent entirely for anybody who is not a Manager: the section would be a
 * paragraph about a Role they do not hold.
 */
function YourScopes({ scopes }: { scopes: OwnScope[] }) {
  if (scopes.length === 0) return null

  return (
    <section aria-labelledby="scope">
      <h2 id="scope" className="text-heading-lg">
        Your Scope
      </h2>
      <p className="text-text-secondary mt-2 text-sm">
        As a Manager you see these Members and nobody else. An Owner or an Admin
        decides who is on the list.
      </p>

      {scopes.map((scope) => (
        <div
          key={scope.managerMemberId}
          className="border-rule mt-4 rounded border p-4"
        >
          {scopes.length > 1 ? (
            <h3 className="text-heading">{scope.orgName}</h3>
          ) : (
            <h3 className="sr-only">{scope.orgName}</h3>
          )}

          {scope.members.length === 0 ? (
            <p className="text-text-muted text-sm">
              Nobody yet, so Costs shows you your own Turns and no one
              else&apos;s. An Owner or an Admin of {scope.orgName} can add
              people.
            </p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1">
              {scope.members.map((member) => (
                <li key={member.memberId} className="text-sm break-all">
                  {member.email}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </section>
  )
}
