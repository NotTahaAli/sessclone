'use client'

import { useActionState } from 'react'

import { acceptAction } from './actions'

// The deliberate click that a GET could not be. Client-side because the
// refusal is a sentence a stranger can act on — expired, wrong address, no
// Seat — rather than an error boundary.

export function AcceptForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(acceptAction, null)

  return (
    <>
      <form action={formAction} className="mt-4">
        <input type="hidden" name="token" value={token} />
        <button
          type="submit"
          disabled={pending}
          className="bg-accent-fill text-accent-on-fill inline-flex h-[var(--control-h)] items-center rounded-md px-4 text-body"
        >
          {pending ? 'Joining…' : 'Accept invitation'}
        </button>
      </form>

      <p
        role="status"
        aria-live="polite"
        className="text-bad-text mt-3 text-sm"
      >
        {state?.error ?? ''}
      </p>
    </>
  )
}
