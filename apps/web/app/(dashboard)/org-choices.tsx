'use client'

import Link from 'next/link'
import { useActionState, useCallback, useState } from 'react'

import { buttonClass } from '../_ui/primitives'
import { ROLE_LABEL } from './account'
import {
  acceptInvite,
  declineInvite,
  leaveCurrentOrg,
  switchOrg,
  type OrgActionState,
} from './org-actions'
import type {
  OrgChoice,
  OrgSwitcherData,
  PendingInvite,
} from '../../lib/viewer'

// The Org switcher's lists: the Orgs the viewer is a Member of, the
// invitations addressed to them, and leaving the current Org. Every control is
// a form posting to a Server Action (`org-actions.ts`), so each works before
// JavaScript as Sign out does; `useActionState` only adds the refusal's
// sentence once it has loaded.

const DAY = 86_400_000

/** Whole days until `at`, negative once it has passed. `now` is the server's
 * read time, so the server and the browser print the same figure. */
export const daysUntil = (at: string, now: string) =>
  Math.ceil((Date.parse(at) - Date.parse(now)) / DAY)

const HEADING =
  'text-label text-text-muted flex items-baseline justify-between px-2 pt-2 pb-1 uppercase'

const ORG_ROW =
  'hover:bg-surface-hover grid w-full cursor-pointer grid-cols-[12px_minmax(0,1fr)_auto] items-baseline gap-x-2 rounded-md px-2 py-1.5 text-left text-[13px]'

const QUIET =
  'text-text-muted hover:text-text cursor-pointer text-caption underline'

function Refusal({ state }: { state: OrgActionState }) {
  return state ? (
    <p role="alert" className="text-bad-text px-2 pt-1 text-caption">
      {state.error}
    </p>
  ) : null
}

function OrgRow({ org, current }: { org: OrgChoice; current: boolean }) {
  const [state, action, pending] = useActionState(switchOrg, null)
  const body = (
    <>
      <span aria-hidden="true" className="text-center">
        {current ? '✓' : ''}
      </span>
      <span className="truncate">{org.orgName}</span>
      <span className="text-text-muted text-caption">
        {ROLE_LABEL[org.role]}
      </span>
      {org.locked ? (
        <span className="text-text-muted col-start-2 col-end-4 text-caption">
          Waiting for approval
        </span>
      ) : null}
    </>
  )

  // The current Org is where the reader already is: a row, not a button.
  if (current) {
    return (
      <li aria-current="true" className={`${ORG_ROW} bg-selected cursor-auto`}>
        {body}
      </li>
    )
  }

  return (
    <li>
      <form action={action}>
        <input type="hidden" name="memberId" value={org.memberId} />
        <button type="submit" disabled={pending} className={ORG_ROW}>
          {body}
        </button>
      </form>
      <Refusal state={state} />
    </li>
  )
}

function InviteRow({ invite, now }: { invite: PendingInvite; now: string }) {
  const [accepted, accept, accepting] = useActionState(acceptInvite, null)
  const [declined, decline, declining] = useActionState(declineInvite, null)
  const days = daysUntil(invite.expiresAt, now)
  const expired = days <= 0

  return (
    <li className="border-rule grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 border-t px-2 py-2 text-[13px] first:border-t-0">
      <span className={`truncate ${expired ? 'text-text-muted' : ''}`}>
        {invite.orgName}
      </span>
      <span className="text-text-muted text-caption">
        {ROLE_LABEL[invite.role]}
      </span>
      <span className="text-text-muted col-span-2 truncate text-caption">
        {invite.invitedBy ? `From ${invite.invitedBy} · ` : ''}
        {expired ? (
          <>
            expired <span className="font-mono">{-days}d</span> ago
          </>
        ) : (
          <>
            expires in <span className="font-mono">{days}d</span>
          </>
        )}
      </span>
      <span className="col-span-2 mt-2 flex items-center gap-3">
        {expired ? (
          <span className="text-text-muted text-caption">
            Ask {invite.orgName} for a new one.
          </span>
        ) : (
          <form action={accept}>
            <input type="hidden" name="invitationId" value={invite.id} />
            <button
              type="submit"
              disabled={accepting || declining}
              className={buttonClass('secondary')}
            >
              {accepting ? 'Joining…' : 'Accept'}
            </button>
          </form>
        )}
        <form action={decline} className="ml-auto">
          <input type="hidden" name="invitationId" value={invite.id} />
          <button
            type="submit"
            disabled={accepting || declining}
            className={QUIET}
          >
            {expired ? 'Dismiss' : 'Decline'}
            <span className="sr-only"> the invitation to {invite.orgName}</span>
          </button>
        </form>
      </span>
      <span className="col-span-2">
        <Refusal state={accepted ?? declined} />
      </span>
    </li>
  )
}

/** Leaving the current Org, behind a second press. The last Owner is told
 * what to do first instead (Taha, 2026-09-25). */
function Leave({
  memberId,
  orgName,
  lastOwner,
}: {
  memberId: string
  orgName: string
  lastOwner: boolean
}) {
  const [state, action, pending] = useActionState(leaveCurrentOrg, null)
  const [asked, setAsked] = useState(false)
  const ask = useCallback(() => setAsked(true), [])
  const cancel = useCallback(() => setAsked(false), [])

  if (lastOwner) {
    return (
      <p className="text-text-muted px-2 py-2 text-caption">
        You are {orgName}&apos;s only Owner, so you cannot leave it. Make
        somebody else an Owner in{' '}
        <Link href="/settings/org/members" className="underline">
          Members
        </Link>{' '}
        first.
      </p>
    )
  }

  return (
    <div className="px-2 py-2">
      {asked ? (
        <form action={action} className="flex items-center gap-3">
          <input type="hidden" name="memberId" value={memberId} />
          <span className="text-caption">Leave {orgName}?</span>
          <button
            type="submit"
            disabled={pending}
            className={buttonClass('primary')}
          >
            {pending ? 'Leaving…' : 'Leave'}
          </button>
          <button type="button" onClick={cancel} className={QUIET}>
            Cancel
          </button>
        </form>
      ) : (
        <button type="button" onClick={ask} className={QUIET}>
          Leave {orgName}
        </button>
      )}
      <Refusal state={state} />
    </div>
  )
}

/** The lists, in the order a reader wants them: where you are, then what is
 * waiting on you, then the way out. */
export function SwitcherBody({
  data,
  current,
  orgName,
}: {
  data: OrgSwitcherData
  /** The viewer's current membership. */
  current: string
  orgName: string
}) {
  const { orgs, invites, now, lastOwner } = data
  return (
    <>
      {orgs.length > 1 ? (
        <section>
          <h2 className={HEADING}>Orgs</h2>
          <ul>
            {orgs.map((org) => (
              <OrgRow
                key={org.memberId}
                org={org}
                current={org.memberId === current}
              />
            ))}
          </ul>
        </section>
      ) : null}
      {invites.length > 0 ? (
        <section
          className={orgs.length > 1 ? 'border-rule mt-1.5 border-t' : ''}
        >
          <h2 className={HEADING}>Pending invites</h2>
          <ul className="flex flex-col">
            {invites.map((invite) => (
              <InviteRow key={invite.id} invite={invite} now={now} />
            ))}
          </ul>
        </section>
      ) : null}
      <div
        className={
          orgs.length > 1 || invites.length > 0
            ? 'border-rule mt-1.5 border-t'
            : ''
        }
      >
        <Leave memberId={current} orgName={orgName} lastOwner={lastOwner} />
      </div>
    </>
  )
}

/** Whether the switcher has anything to offer: another Org, an invitation,
 * or a way out. A sole Owner of their one Org sees the name as plain text. */
export const hasChoices = (data: OrgSwitcherData) =>
  data.orgs.length > 1 || data.invites.length > 0 || !data.lastOwner

/** The invitations that can still be accepted: the one accent mark on the
 * closed control. */
export const liveInvites = (data: OrgSwitcherData) =>
  data.invites.filter((invite) => daysUntil(invite.expiresAt, data.now) > 0)
    .length
