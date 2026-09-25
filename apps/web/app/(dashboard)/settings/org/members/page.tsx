import { notFound } from 'next/navigation'

import { setScopeMember } from './actions'
import { withdrawInvite } from './invite-actions'
import { InviteForm } from './invite-form'
import { PersonControls } from './people-controls'
import { PageHeader } from '../../../page-header'
import { Row, SectionBreak } from '../../../../_ui/primitives'
import { asViewer } from '../../../../../lib/db'
import {
  listOrgMembers,
  listScopes,
  type OrgMember,
} from '../../../../../lib/scopes'
import { appUrl } from '../../../../../lib/auth/app-url'
import {
  listInvitations,
  type Invitation,
} from '../../../../../lib/invitations'
import { currentViewer, reachesOrgSettings } from '../../../../../lib/viewer'

// Ticket 46: an Owner or Admin assigns which Members a Manager may see.
// Invitations, Role changes and removal (tickets 49 and 50) are here too,
// beside the people they are about.
//
// The Scope is not enforced here and must never be. `member_scopes` carries
// its own policies and `sessclone_visible_member_ids()` resolves every read of
// a Turn, a Device, a Project or a Log Artifact through it, so what this page
// writes is the fact and the policies are the rule (ADR 0001).
//
// Ticket 113 draws it as rows: invitations with their state glyph, people
// with their Role as a pill on the right, and each Manager's Scope under a
// section break of its own.

/** One shared empty set, so a Manager with no Scope is not a new object. */
const NONE: ReadonlySet<string> = new Set()

const QUIET =
  'text-text-muted hover:text-text text-caption whitespace-nowrap underline'

export default async function Members() {
  const viewer = await currentViewer()
  if (!viewer || !reachesOrgSettings(viewer.role)) notFound()

  // One transaction, independent statements — and `listScopes` is one query
  // for the whole Org rather than one per Manager, which on a page with five
  // Managers would be the query-in-a-loop this repo calls a bug.
  const [{ members, more }, scopes, invitations] = await asViewer(
    viewer.userId,
    (tx) =>
      Promise.all([
        listOrgMembers(tx, viewer.orgId),
        listScopes(tx, viewer.orgId),
        listInvitations(tx, viewer.orgId),
      ]),
  )

  const managers = members.filter(
    (member) => member.role === 'manager' && !member.removed,
  )
  const active = members.filter((member) => !member.removed).length

  return (
    <div className="flex max-w-3xl flex-col">
      <PageHeader title="Members" back="/settings" />

      <SectionBreak>Invite</SectionBreak>
      <InviteForm origin={appUrl()} orgId={viewer.orgId} />
      <p className="text-text-muted text-caption">
        An invitation is a link for one address. It works once, for seven days,
        and the Seat is taken when the person accepts rather than when you send
        it — so an invitation sent today can still be refused if the Org fills
        up first.
      </p>
      {invitations.invitations.length > 0 ? (
        <ol className="mt-1">
          {invitations.invitations.map((invitation) => (
            <InvitationRow
              key={invitation.id}
              invitation={invitation}
              orgId={viewer.orgId}
            />
          ))}
        </ol>
      ) : null}
      {invitations.more ? (
        <p className="text-text-muted mt-1 text-caption">
          Showing the most recent invitations.
        </p>
      ) : null}

      <SectionBreak>
        People · {active} {active === 1 ? 'Member' : 'Members'}
      </SectionBreak>
      <p className="text-text-muted text-caption">
        A Role takes effect at once. Removing somebody frees their Seat and
        stops their keys reporting, and keeps everything they have already spent
        in this Org&apos;s history — so the totals still add up.
      </p>
      <ol className="mt-1">
        {members.map((member) => (
          <li key={member.memberId} className="flex items-start gap-3">
            {/* Ticket 91: their name when they have set one, and their
                address underneath either way — this is the page an Admin
                changes a Role from, and two people called Taha is the
                ordinary case. */}
            <div className="min-w-0 flex-1">
              <Row
                mark={(member.name ?? member.email).slice(0, 1).toUpperCase()}
                markClass={INITIAL}
                sub={`${member.name ? `${member.email} · ` : ''}${member.role}${
                  member.removed ? ' — removed, history kept' : ''
                }`}
              >
                <span className={member.removed ? 'text-text-muted' : ''}>
                  {member.name ?? member.email}
                </span>
              </Row>
            </div>
            <div className="pt-1.5">
              <PersonControls
                memberId={member.memberId}
                role={member.role}
                who={member.name ?? member.email}
                removed={member.removed}
              />
            </div>
          </li>
        ))}
      </ol>
      {more ? (
        <p className="text-text-muted mt-1 text-caption">
          Showing the first 200 Members.
        </p>
      ) : null}

      {/* A Manager sees the Members you give them and nobody else; one with
          nobody assigned sees nothing at all, which is where every Manager
          starts. */}
      {managers.length === 0 ? (
        <>
          <SectionBreak>Manager Scopes</SectionBreak>
          <p className="text-text-muted py-1 text-body">
            Nobody in this Org is a Manager yet. Give someone the Manager Role
            and their Scope appears here.
          </p>
        </>
      ) : (
        managers.map((manager) => (
          <Scope
            key={manager.memberId}
            manager={manager}
            members={members}
            scope={scopes.get(manager.memberId) ?? NONE}
          />
        ))
      )}
    </div>
  )
}

/** A person's lead mark: their initial in a small disc. */
const INITIAL =
  'bg-surface-hover text-text-muted grid size-3.5 place-items-center rounded-full text-[9px]'

/**
 * One Manager, and every Member they could be given.
 *
 * A Manager is listed among the assignable Members rather than filtered out:
 * their own Turns are their own and `sessclone_visible_member_ids()` already
 * returns them. A removed Member is listed too, and marked — their history is
 * still in the Org, and a Scope that silently dropped them would change what a
 * past chart shows.
 */
function Scope({
  manager,
  members,
  scope,
}: {
  manager: OrgMember
  members: OrgMember[]
  scope: ReadonlySet<string>
}) {
  const assigned = members.filter((member) => scope.has(member.memberId)).length
  const whose = manager.name ?? manager.email

  return (
    <section aria-label={`${whose}'s Scope`}>
      <SectionBreak as="h3">
        {whose}&apos;s Scope ·{' '}
        {assigned === 0 ? 'sees nothing' : `sees ${assigned}`}
      </SectionBreak>
      <ol>
        {members.map((member) => {
          const included = scope.has(member.memberId)
          const who = member.name ?? member.email
          return (
            <li key={member.memberId} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <Row
                  lead={included ? 'ok' : 'idle'}
                  name={who}
                  sub={`${member.name ? `${member.email} · ` : ''}${member.role}${
                    member.removed ? ' — removed, history kept' : ''
                  }`}
                />
              </div>
              <form action={setScopeMember}>
                <input
                  type="hidden"
                  name="managerMemberId"
                  value={manager.memberId}
                />
                <input type="hidden" name="memberId" value={member.memberId} />
                {/* The state being moved to rather than a toggle, so
                        two presses of a stale page land on the same Scope. */}
                <input
                  type="hidden"
                  name="to"
                  value={included ? 'off' : 'on'}
                />
                <button type="submit" className={QUIET}>
                  {included ? 'Remove' : 'Add'}
                  <span className="sr-only">
                    {included
                      ? ` ${who} from ${whose}'s Scope`
                      : ` ${who} to ${whose}'s Scope`}
                  </span>
                </button>
              </form>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

/** One invitation, and the one thing that can still be done to it. */
function InvitationRow({
  invitation,
  orgId,
}: {
  invitation: Invitation
  orgId: string
}) {
  const state = invitation.acceptedAt
    ? 'accepted'
    : invitation.revokedAt
      ? 'withdrawn'
      : invitation.declined
        ? 'declined'
        : invitation.live
          ? `waiting, until ${when.format(invitation.expiresAt)}`
          : 'expired'

  return (
    <li className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <Row
          lead={invitation.acceptedAt ? 'ok' : 'idle'}
          sub={`${invitation.role} · ${state}`}
        >
          <span className={invitation.live ? '' : 'text-text-muted'}>
            {invitation.email}
          </span>
        </Row>
      </div>
      {invitation.live ? (
        <form action={withdrawInvite}>
          <input type="hidden" name="invitationId" value={invitation.id} />
          <input type="hidden" name="orgId" value={orgId} />
          <button type="submit" className={QUIET}>
            Withdraw
            <span className="sr-only">
              {' '}
              the invitation to {invitation.email}
            </span>
          </button>
        </form>
      ) : null}
    </li>
  )
}

// The Org's timezone is not read here: an expiry is a date on a link, not a
// figure cut into the Org's days, and this page has no other dates on it.
const when = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' })
