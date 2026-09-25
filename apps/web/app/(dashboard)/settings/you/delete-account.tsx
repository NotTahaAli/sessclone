'use client'

import Link from 'next/link'
import { useActionState, useCallback, useState } from 'react'

import {
  requestAccountDeletion,
  signInAgain,
  type DeletionState,
} from './deletion-actions'
import { Button, buttonClass, inputClass } from '../../../_ui/primitives'

// Ticket 141: the Delete account section, at the foot of Settings > You.
//
// Behind a first press, then the address typed out. Blocking Orgs are named
// before the form is offered at all: a sole Owner of an Org with other
// people in it has something to do first, and a form that then refuses
// them is a worse way to find out.

export function DeleteAccount({
  email,
  blockers,
  graceDays,
}: {
  email: string
  blockers: { org_name: string }[]
  graceDays: number
}) {
  const [state, action, pending] = useActionState<DeletionState, FormData>(
    requestAccountDeletion,
    null,
  )
  const [asked, setAsked] = useState(false)
  const ask = useCallback(() => setAsked(true), [])
  const cancel = useCallback(() => setAsked(false), [])

  const explanation = (
    <p className="text-text-muted text-caption">
      Your name, email, memberships, API keys and stored transcripts are removed
      after {graceDays} days. Until then you are signed out and nothing is
      recorded; signing in lets you keep the account. The Turns you ran stay in
      each Org&apos;s costs as &ldquo;Deleted person&rdquo;, because they are
      that Org&apos;s spend record.
    </p>
  )

  if (blockers.length > 0) {
    return (
      <div className="flex flex-col gap-2 py-3">
        {explanation}
        <p className="text-caption">
          You are the only Owner of{' '}
          {blockers.map((row) => row.org_name).join(', ')}, which{' '}
          {blockers.length === 1 ? 'has' : 'have'} other people in{' '}
          {blockers.length === 1 ? 'it' : 'them'}. Make one of them an Owner in{' '}
          <Link href="/settings/org/members" className="underline">
            Members
          </Link>{' '}
          first.
        </p>
      </div>
    )
  }

  if (state?.stale) {
    return (
      <div className="flex flex-col gap-2 py-3">
        <p className="text-caption">
          For this you need to have signed in within the last ten minutes.
        </p>
        <form action={signInAgain}>
          <Button type="submit">Sign in again</Button>
        </form>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 py-3">
      {explanation}
      {asked ? (
        <form action={action} className="flex flex-col gap-2">
          <label htmlFor="delete-email" className="text-caption">
            Type <span className="font-mono">{email}</span> to confirm
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id="delete-email"
              name="email"
              type="email"
              autoComplete="off"
              required
              className={`${inputClass} w-full max-w-xs`}
            />
            <button
              type="submit"
              disabled={pending}
              className={buttonClass('danger')}
            >
              {pending ? 'Deleting…' : 'Delete my account'}
            </button>
            <Button onClick={cancel}>Cancel</Button>
          </div>
          {state?.error ? (
            <p role="alert" className="text-bad-text text-caption">
              {state.error}
            </p>
          ) : null}
        </form>
      ) : (
        <div>
          <button type="button" onClick={ask} className={buttonClass('danger')}>
            Delete account…
          </button>
        </div>
      )}
    </div>
  )
}
