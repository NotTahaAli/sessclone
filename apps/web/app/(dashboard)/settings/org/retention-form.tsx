'use client'

import { useActionState } from 'react'

import { setRetention } from './actions'

// Ticket 61's control. Client-side for the same reason the timezone form is:
// the answer to "did that save" lives in `useActionState`'s return value, and
// a refusal — by policy, or by the Tier's ceiling — is otherwise either an
// error page or a page that looks like it worked.

export function RetentionForm({
  orgId,
  current,
  ceiling,
}: {
  orgId: string
  current: number
  /** The Tier's ceiling in days, or null for a Tier with none. */
  ceiling: number | null
}) {
  const [state, formAction, pending] = useActionState(setRetention, null)

  return (
    <>
      <form action={formAction} className="mt-4 flex flex-wrap items-end gap-3">
        <input type="hidden" name="orgId" value={orgId} />
        <div className="flex flex-col gap-1">
          <label
            className="text-text-secondary text-sm"
            htmlFor="retention-days"
          >
            Days
          </label>
          <input
            id="retention-days"
            name="days"
            type="number"
            inputMode="numeric"
            min={1}
            // The Tier's ceiling, so the control refuses in the browser what
            // the trigger refuses in the database rather than only after a
            // round trip. It is not the check — the trigger is.
            max={ceiling ?? 3650}
            defaultValue={current}
            className="border-control-border text-text w-28 rounded border px-3 py-1 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="border-control-border text-text rounded border px-3 py-1 text-sm"
        >
          {pending ? 'Saving…' : 'Save retention'}
        </button>
      </form>

      {state && 'error' in state ? (
        <p className="text-bad-text mt-3 text-sm">{state.error}</p>
      ) : null}
      {state && 'saved' in state ? (
        <p className="text-ok-text mt-3 text-sm">
          Transcripts are now kept for {state.saved} day
          {state.saved === 1 ? '' : 's'}. Anything already past that is removed
          by the next sweep, not immediately.
        </p>
      ) : null}
    </>
  )
}
