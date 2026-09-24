import Link from 'next/link'

import { setArchival, setName, setProject } from './actions'
import { setOwnAccent } from './appearance-actions'
import { ThemeForm } from './theme-form'
import {
  listArchivalMemberships,
  listArchivalProjects,
  type ArchivalMembership,
  type ArchivalProject,
} from '../../../../lib/archival'
import { ownScopes, type OwnScope } from '../../../../lib/scopes'
import { ownDisplayName } from '../../../../lib/names'
import { InlineName } from '../../inline-name'
import { PageHeader } from '../../page-header'
import { AccentPreview } from '../appearance-preview'
import { SeedPicker } from '../seed-picker'
import { SwitchForm } from '../switch-form'
import { Field, Row, SectionBreak } from '../../../_ui/primitives'
import { viewerAppearance } from '../../../../lib/appearance'
import { asViewer } from '../../../../lib/db'
import { signedInUser } from '../../../../lib/supabase/server'

// Ticket 72: `/settings/you`, the destination `docs/design/product-ia.md`
// gives every Role, carrying the settings that are the Member's own: archival,
// a Manager's own Scope (ticket 46), appearance (77) and the name (91).
//
// ADR 0005 is what this page is the surface of, and its two rules shape every
// control here: the master switch is the Member's own and starts off, and the
// per-Project setting is an opt-out list *inside* it — so a Project with no
// row inherits the switch, and a new repository is archived without a visit.
//
// Ticket 113 draws it as rows: label on the left, value or control on the
// right, edited in place. A switch saves when flipped, a pencil opens the
// name, a swatch saves when pressed — no boxed form, no Save for one value.

/** One shared empty list, so a membership with no Projects is not a new array. */
const EMPTY: ArchivalProject[] = []

export default async function YourSettings() {
  const user = await signedInUser()

  // The shell above has already said so for every page under it, so this is
  // narrowing for the type checker rather than a second message.
  if (!user) return null

  // One transaction, which is what `asViewer` opens and what carries the
  // viewer's claim. The statements are independent, so they go together.
  const [memberships, projects, scopes, appearance, displayName] =
    await asViewer(user.id, (tx) =>
      Promise.all([
        listArchivalMemberships(tx),
        listArchivalProjects(tx),
        ownScopes(tx),
        viewerAppearance(tx),
        ownDisplayName(tx, user.id),
      ]),
    )

  // Grouped once here rather than filtered inside the render, which would be
  // a pass over the whole list per membership.
  const byMember = new Map<string, ArchivalProject[]>()
  for (const project of projects) {
    let group = byMember.get(project.member_id)
    if (!group) byMember.set(project.member_id, (group = []))
    group.push(project)
  }

  const first = memberships[0]

  return (
    <div className="flex max-w-3xl flex-col">
      <PageHeader title="Your settings" back="/settings" />

      <SectionBreak>Profile</SectionBreak>
      {/* Ticket 91, first because it is the one thing on this page other
          people see. A pencil rather than a form: it is one short string. */}
      <Field
        label="Name"
        hint="Shown wherever your address would be, with the address beside it. Save an empty box to go back to the address alone."
      >
        <InlineName
          action={setName}
          current={displayName}
          fallback={user.email ?? 'your address'}
          label="Your name"
          placeholder="Taha"
        />
      </Field>
      <Field label="Email">{user.email ?? '—'}</Field>

      <YourScopes scopes={scopes} />

      {/* Ticket 77. Light or dark is always yours; the accent is yours unless
          the Org has locked it, and it only paints the few things that are
          "now" — never the status colours or a chart's series, which have to
          mean the same thing across a desk. */}
      {first ? (
        <>
          <SectionBreak>Appearance</SectionBreak>
          <Field label="Theme">
            <ThemeForm memberId={first.member_id} current={appearance.theme} />
          </Field>
          {appearance.locked ? (
            <Field
              label="Accent"
              hint="Your Org has locked its accent colour. If you had chosen one it is still stored, and applies again when the lock is lifted."
            >
              {appearance.orgSeed}
            </Field>
          ) : (
            <Field
              label="Accent"
              hint={
                appearance.ownSeed
                  ? 'Yours, on your screens only. The last swatch takes any colour.'
                  : 'Your Org’s, until you pick one. The last swatch takes any colour; yours shows on your screens only.'
              }
            >
              <SeedPicker
                action={setOwnAccent}
                field="memberId"
                rowId={first.member_id}
                current={appearance.ownSeed}
                orgSeed={appearance.orgSeed}
                inheritable
                label={
                  appearance.ownSeed
                    ? 'Your accent colour'
                    : 'Your accent colour, currently your Org’s'
                }
              />
            </Field>
          )}
          <AccentPreview seed={appearance.seed} tones={appearance.tones} />
        </>
      ) : null}

      <SectionBreak>Transcript upload</SectionBreak>
      <BeforeYouOptIn />

      {memberships.length === 0 ? (
        <p className="text-text-muted py-3 text-body">
          You are not a Member of an Org yet, so there is nothing to archive.
        </p>
      ) : (
        memberships.map((membership) => (
          <OrgArchival
            key={membership.member_id}
            membership={membership}
            projects={byMember.get(membership.member_id) ?? EMPTY}
          />
        ))
      )}

      {/* Ticket 87: the stored transcripts are `/transcripts`. What stays
          here is the switch — a change to make, rather than a thing to find. */}
      <p className="text-text-muted mt-4 text-caption">
        What has already been uploaded, and the controls to delete it, are on{' '}
        <Link href="/transcripts" className="text-text underline">
          Transcripts
        </Link>
        .
      </p>
    </div>
  )
}

/**
 * What a transcript from a shared environment contains, said before the switch
 * rather than after it (ticket 72, finding 74). A Claude Projects session
 * carries the project's conversation, and everybody else in that project
 * writes into it too — so turning the switch on is a decision about more than
 * your own messages, and somebody who learns that from the archive has learned
 * it too late.
 */
function BeforeYouOptIn() {
  return (
    <div className="text-text-muted py-1 text-caption">
      <p>
        Usage and cost are always reported. Archival is separate: it uploads the
        session transcripts themselves, for Owners and Admins to read later. It
        is off until you turn it on, and nobody in your Org can turn it on for
        you.
      </p>
      <p className="mt-1.5">
        <span className="text-warn-text font-medium">
          Before you turn it on:
        </span>{' '}
        a transcript holds everything the session saw — your prompts, the
        model&apos;s replies, the files it read and the commands it ran. That
        can include source code and, in a file it happened to open, a
        credential. From a shared environment it holds more than your own work:
        in Claude Projects a session carries the project&apos;s own
        conversation, so the messages other members wrote there are in the
        transcript you upload.
      </p>
      <p className="mt-1.5">
        Turning it on archives the sessions Claude Code still keeps on your
        machines, which is 30 days by default. To keep more for a later
        backfill, raise <code>cleanupPeriodDays</code> in your Claude Code
        settings. Where your organisation manages Claude Code settings, its
        value wins, so ask whoever manages them.
      </p>
    </div>
  )
}

/**
 * One membership's switch, and every Project under it as an indented row.
 * The Org is named on the row, since a person in two Orgs has two switches.
 */
function OrgArchival({
  membership,
  projects,
}: {
  membership: ArchivalMembership
  projects: ArchivalProject[]
}) {
  const on = membership.archival_enabled

  return (
    <>
      <Field
        label={membership.org_name}
        // ADR 0005: off is forward-only. Two intentions, two actions — stop
        // collecting, and destroy what you hold — said beside a switch that
        // is currently on.
        hint={
          on
            ? 'On: new sessions upload unless you exclude their Project below. Turning it off stops new uploads and keeps what is stored, which ages out under your Org’s retention; deleting is a separate action.'
            : 'Off: nothing leaves your machines.'
        }
      >
        <SwitchForm
          action={setArchival}
          hidden={`memberId=${membership.member_id}`}
          checked={on}
          label={`Archive transcripts for ${membership.org_name}`}
        />
      </Field>
      {projects.length === 0 ? (
        <p className="text-text-muted py-2 pl-3.5 text-caption">
          No Projects yet. One appears here once a Collector reports a session
          from it.
        </p>
      ) : (
        // Every Project the Member has Sessions in, so an exclusion can be
        // made without guessing a key — which matters most for a `local:`
        // key, a hostname and a path nobody types correctly from memory.
        // Null is the common case: no row, so it follows the switch.
        projects.map((project) => {
          const excluded = project.archival_enabled === false
          return (
            <Field
              key={project.project_id}
              indent
              mono
              label={project.key}
              hint={
                excluded
                  ? 'Excluded — sessions here never upload.'
                  : on
                    ? undefined
                    : 'Would be archived, once the switch is on.'
              }
            >
              <SwitchForm
                action={setProject}
                hidden={`memberId=${membership.member_id}&projectId=${project.project_id}`}
                checked={!excluded}
                label={`Archive ${project.key}`}
              />
            </Field>
          )
        })
      )}
    </>
  )
}

/**
 * A Manager's own Scope, which is ticket 46's second criterion.
 *
 * A Manager who cannot see their Scope cannot tell a Member they were never
 * given from a Member who has reported nothing. So the empty case says out
 * loud that it is empty and who changes it. Absent for anybody who is not a
 * Manager.
 */
function YourScopes({ scopes }: { scopes: OwnScope[] }) {
  if (scopes.length === 0) return null

  return (
    <>
      {scopes.map((scope) => (
        <section
          key={scope.managerMemberId}
          aria-label={`Your Scope in ${scope.orgName}`}
        >
          <SectionBreak>
            {scopes.length > 1
              ? `Your Scope in ${scope.orgName}`
              : 'Your Scope'}
          </SectionBreak>
          {scope.members.length === 0 ? (
            <p className="text-text-muted py-1 text-body">
              Nobody yet, so Costs shows you your own Turns and no one
              else&apos;s. An Owner or an Admin of {scope.orgName} can add
              people.
            </p>
          ) : (
            <>
              <p className="text-text-muted text-caption">
                As a Manager you see these Members and nobody else. An Owner or
                an Admin decides who is on the list.
              </p>
              <ol>
                {scope.members.map((member) => (
                  <li key={member.memberId}>
                    <Row lead="none" name={member.email} />
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>
      ))}
    </>
  )
}
