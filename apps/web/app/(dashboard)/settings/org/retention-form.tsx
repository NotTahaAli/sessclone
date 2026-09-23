'use client'

import { useActionState, useCallback, useState } from 'react'

import { setRetention } from './actions'
import { inputClass } from '../../../_ui/primitives'

// Ticket 61's control. Client-side for the same reason the timezone form is:
// the answer to "did that save" lives in `useActionState`'s return value, and
// a refusal — by policy, or by the Tier's ceiling — is otherwise either an
// error page or a page that looks like it worked.
//
// Ticket 113: the number in its row with a pencil, as every name on the
// dashboard is (`inline-name.tsx`); the box and a tick appear in its place.

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
  const [editing, setEditing] = useState(false)
  const [handled, setHandled] = useState(state)

  // Closed on the render that first sees a save, as `InlineName` does; a
  // refusal keeps the box open with the number still in it.
  if (handled !== state) {
    setHandled(state)
    if (state && 'saved' in state) setEditing(false)
  }

  const open = useCallback(() => setEditing(true), [])
  const close = useCallback(() => setEditing(false), [])
  const days = state && 'saved' in state ? state.saved : current

  return (
    <div className="flex flex-col items-end gap-1">
      {editing ? (
        <form action={formAction} className="flex items-center gap-1">
          <input type="hidden" name="orgId" value={orgId} />
          <label className="sr-only" htmlFor="retention-days">
            Days to keep transcripts
          </label>
          <input
            id="retention-days"
            name="days"
            type="number"
            inputMode="numeric"
            autoFocus
            min={1}
            // The Tier's ceiling, so the control refuses in the browser what
            // the trigger refuses in the database rather than only after a
            // round trip. It is not the check — the trigger is.
            max={ceiling ?? 3650}
            defaultValue={days}
            className={`${inputClass} h-7 w-20 font-mono text-caption`}
          />
          <span className="text-text-muted text-caption">days</span>
          <button
            type="submit"
            disabled={pending}
            aria-label="Save retention"
            className="text-text px-1 text-body"
          >
            {pending ? '…' : '✓'}
          </button>
          <button
            type="button"
            onClick={close}
            aria-label="Stop editing retention"
            className="text-text-muted px-1 text-body"
          >
            ✕
          </button>
        </form>
      ) : (
        <span className="inline-flex items-center gap-1">
          <span className="text-text-muted font-mono text-[13px]">
            {days} {days === 1 ? 'day' : 'days'}
          </span>
          <button
            type="button"
            onClick={open}
            aria-label="Change how long transcripts are kept"
            title="Change"
            className="text-text-muted hover:text-text inline-flex h-8 w-8 items-center justify-center text-sm"
          >
            ✎
          </button>
        </span>
      )}

      {/* Announced rather than only rendered: the result of changing how long
          transcripts are kept is not something to go looking for. */}
      <div aria-live="polite" className="text-right text-caption">
        {state && 'error' in state ? (
          <p className="text-bad-text">{state.error}</p>
        ) : null}
        {state && 'saved' in state ? (
          <p className="text-text-muted">
            Anything already past {state.saved} day
            {state.saved === 1 ? '' : 's'} is removed by the next sweep, not
            immediately.
          </p>
        ) : null}
      </div>
    </div>
  )
}
