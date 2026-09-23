'use client'

import { useActionState, useCallback, type ChangeEvent } from 'react'

import { setTimezone } from './actions'
import { inputClass } from '../../../_ui/primitives'

// Client-side for one reason: the answer to "did that save" lives in
// `useActionState`'s return value. Without it a refusal — by policy, or by the
// guard on the column — is either an error page or a page that looks like it
// worked, and both are worse than a sentence.
//
// Ticket 113: the value in its row, edited in place. A native `select` —
// the list is long and a native picker type-aheads, which beats anything worth
// shipping here — that saves when a zone is chosen, with no Save button for
// one value.

export function TimezoneForm({
  orgId,
  current,
  zones,
}: {
  orgId: string
  current: string
  zones: string[]
}) {
  const [state, formAction, pending] = useActionState(setTimezone, null)

  const submit = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) =>
      event.currentTarget.form?.requestSubmit(),
    [],
  )

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="orgId" value={orgId} />
      <label className="sr-only" htmlFor="timezone-select">
        Timezone
      </label>
      <select
        id="timezone-select"
        name="timezone"
        defaultValue={current}
        onChange={submit}
        disabled={pending}
        className={`${inputClass} max-w-56 font-mono text-caption`}
      >
        {zones.map((zone) => (
          <option key={zone} value={zone}>
            {zone}
          </option>
        ))}
      </select>
      {/* Without JavaScript the select cannot save itself; this is the
          button it would have been. */}
      <noscript>
        <button type="submit" className="text-caption underline">
          Save
        </button>
      </noscript>

      <div aria-live="polite" className="text-right text-caption">
        {state && 'error' in state ? (
          <p className="text-bad-text">{state.error}</p>
        ) : null}
        {state && 'saved' in state ? (
          <p className="text-text-muted">
            Days are now measured in {state.saved}.
          </p>
        ) : null}
      </div>
    </form>
  )
}
