'use client'

import { useActionState, useCallback } from 'react'

import { deleteRateAction } from './actions'

// Delete is the widest act on this page: removing a Rate reprices every Org's
// history that resolved to it, on the next read. So it asks first, and it says
// what happened — a refusal by `rates_write` writes nothing and raises
// nothing, and a page that stayed silent would look identical either way.

export function DeleteRate({
  rateId,
  said,
}: {
  rateId: string
  /** What is being deleted, for the confirmation and the screen reader. */
  said: string
}) {
  const [state, formAction, pending] = useActionState(deleteRateAction, null)

  // Native `confirm`, which is one line and works on a phone. The Turns this
  // row priced reprice without further warning, so the question is worth
  // asking once.
  const ask = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (!confirm(`Delete the ${said}? Turns priced by it reprice.`)) {
        event.preventDefault()
      }
    },
    [said],
  )

  return (
    <form action={formAction} className="mt-1">
      <input type="hidden" name="rateId" value={rateId} />
      <button
        type="submit"
        disabled={pending}
        onClick={ask}
        className="text-text-muted text-caption underline"
      >
        {pending ? 'Deleting…' : 'Delete'}
        <span className="sr-only"> {said}</span>
      </button>
      <span role="status" aria-live="polite" className="text-caption">
        {state && 'error' in state ? (
          <span className="text-bad-text"> {state.error}</span>
        ) : null}
      </span>
    </form>
  )
}
