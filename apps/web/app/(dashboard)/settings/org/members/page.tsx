import { notFound } from 'next/navigation'

import { setScopeMember } from './actions'
import { PageHeader } from '../../../page-header'
import { asViewer } from '../../../../../lib/db'
import {
  listOrgMembers,
  listScopes,
  type OrgMember,
} from '../../../../../lib/scopes'
import { currentViewer, reachesOrgSettings } from '../../../../../lib/viewer'

// Ticket 46: an Owner or Admin assigns which Members a Manager may see.
//
// `docs/design/product-ia.md` puts the assignment here, in Org settings →
// Members, beside the people it is about. Invitations, Role changes and
// removal (tickets 49 and 50) land on this page too; the Scope is the first
// thing on it.
//
// The Scope is not enforced here and must never be. `member_scopes` carries
// its own policies and `sessclone_visible_member_ids()` resolves every read of
// a Turn, a Device, a Project or a Log Artifact through it, so what this page
// writes is the fact and the policies are the rule (ADR 0001).

/** One shared empty set, so a Manager with no Scope is not a new object. */
const NONE: ReadonlySet<string> = new Set()

export default async function Members() {
  const viewer = await currentViewer()
  if (!viewer || !reachesOrgSettings(viewer.role)) notFound()

  // One transaction, two independent statements — and `listScopes` is one
  // query for the whole Org rather than one per Manager, which on a page with
  // five Managers would be the query-in-a-loop this repo calls a bug.
  const [members, scopes] = await asViewer(viewer.userId, (tx) =>
    Promise.all([
      listOrgMembers(tx, viewer.orgId),
      listScopes(tx, viewer.orgId),
    ]),
  )

  const managers = members.filter(
    (member) => member.role === 'manager' && !member.removed,
  )

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Members"
        description={`Who is in ${viewer.orgName}, and what each Manager may see.`}
      />

      <section aria-labelledby="scopes">
        <h2 id="scopes" className="text-heading-lg">
          Manager Scopes
        </h2>
        <p className="text-text-secondary mt-2 text-sm">
          A Manager sees the Members you give them and nobody else. A Manager
          with nobody assigned sees nothing at all, which is where every Manager
          starts.
        </p>

        {managers.length === 0 ? (
          <p className="border-rule text-text-muted mt-4 rounded border border-dashed p-6 text-sm">
            Nobody in this Org is a Manager yet. Give someone the Manager Role
            and their Scope appears here.
          </p>
        ) : (
          managers.map((manager) => (
            <Scope
              key={manager.memberId}
              orgId={viewer.orgId}
              manager={manager}
              members={members}
              scope={scopes.get(manager.memberId) ?? NONE}
            />
          ))
        )}
      </section>
    </div>
  )
}

/**
 * One Manager, and every Member they could be given.
 *
 * A Manager is listed among the assignable Members rather than filtered out:
 * their own Turns are their own and `sessclone_visible_member_ids()` already
 * returns them, so hiding the row would suggest a Manager cannot see
 * themselves. A removed Member is listed too, and marked — their history is
 * still in the Org, and a Scope that silently dropped them would change what a
 * past chart shows.
 */
function Scope({
  orgId,
  manager,
  members,
  scope,
}: {
  orgId: string
  manager: OrgMember
  members: OrgMember[]
  scope: ReadonlySet<string>
}) {
  const assigned = members.filter((member) => scope.has(member.memberId)).length

  return (
    <div className="border-rule mt-6 rounded border p-4">
      <h3 className="text-heading break-all">{manager.email}</h3>
      <p className="text-text-secondary mt-1 text-sm">
        {assigned === 0
          ? 'Sees nothing. Assign somebody below.'
          : `Sees ${assigned} ${assigned === 1 ? 'Member' : 'Members'}.`}
      </p>

      <ul className="mt-3">
        {members.map((member) => {
          const included = scope.has(member.memberId)
          return (
            <li
              key={member.memberId}
              className="border-rule flex flex-wrap items-center justify-between gap-3 border-b py-3"
            >
              <div className="min-w-0">
                <p className="text-sm break-all">{member.email}</p>
                <p className="text-text-muted text-sm">
                  {member.role}
                  {member.removed ? ' — removed, history kept' : ''}
                </p>
              </div>
              <form action={setScopeMember}>
                <input type="hidden" name="orgId" value={orgId} />
                <input
                  type="hidden"
                  name="managerMemberId"
                  value={manager.memberId}
                />
                <input type="hidden" name="memberId" value={member.memberId} />
                {/* The state being moved to rather than a toggle, so two
                    presses of a stale page land on the same Scope. */}
                <input
                  type="hidden"
                  name="to"
                  value={included ? 'off' : 'on'}
                />
                <button
                  type="submit"
                  className="border-control-border text-text rounded border px-3 py-1 text-sm whitespace-nowrap"
                >
                  {included ? 'Remove' : 'Add'}
                  <span className="sr-only">
                    {included
                      ? ` ${member.email} from ${manager.email}'s Scope`
                      : ` ${member.email} to ${manager.email}'s Scope`}
                  </span>
                </button>
              </form>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
