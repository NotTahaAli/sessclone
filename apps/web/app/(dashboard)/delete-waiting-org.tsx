'use client'

import { useActionState, useCallback, useState } from 'react'

import type { OrgActionState } from './org-actions'
import { Button, buttonClass, inputClass } from '../_ui/primitives'

// Deleting an Org while it waits for approval (Taha's picks, 2026-09-28): on
// the waiting page for its Owner, and on the Admin panel. Behind a first
// press, then the Org's name typed out, as Delete account asks for the
// address.

export function DeleteWaitingOrg({
  orgId,
  orgName,
  action: write,
}: {
  orgId: string
  orgName: string
  action: (state: OrgActionState, form: FormData) => Promise<OrgActionState>
}) {
  const [state, action, pending] = useActionState<OrgActionState, FormData>(
    write,
    null,
  )
  const [asked, setAsked] = useState(false)
  const ask = useCallback(() => setAsked(true), [])
  const cancel = useCallback(() => setAsked(false), [])

  if (!asked) {
    return (
      <div>
        <button type="button" onClick={ask} className={buttonClass('danger')}>
          Delete this Org…
        </button>
      </div>
    )
  }

  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="orgId" value={orgId} />
      <p className="text-text-muted text-caption">
        {orgName} leaves the waitlist and is gone for good, with its members and
        invitations. Nothing was ever collected for it.
      </p>
      <label htmlFor="delete-org-name" className="text-caption">
        Type <span className="font-mono">{orgName}</span> to confirm
      </label>
      <input
        id="delete-org-name"
        name="name"
        autoComplete="off"
        required
        className={`${inputClass} w-full`}
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending}
          className={buttonClass('danger')}
        >
          {pending ? 'Deleting…' : 'Delete Org'}
        </button>
        <Button onClick={cancel}>Cancel</Button>
      </div>
      {state?.error ? (
        <p role="alert" className="text-bad-text text-caption">
          {state.error}
        </p>
      ) : null}
    </form>
  )
}
