'use client'

import { useActionState } from 'react'

import { setTimezone } from './actions'

// Client-side for one reason: the answer to "did that save" lives in
// `useActionState`'s return value. Without it a refusal — by policy, or by the
// guard on the column — is either an error page or a page that looks like it
// worked, and both are worse than a sentence.

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

  return (
    <>
      <form action={formAction} className="mt-4 flex flex-wrap gap-3">
        <input type="hidden" name="orgId" value={orgId} />
        <label className="sr-only" htmlFor="timezone-select">
          Timezone
        </label>
        <select
          id="timezone-select"
          name="timezone"
          defaultValue={current}
          className="border-control-border text-text rounded border px-3 py-1 text-sm"
        >
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={pending}
          className="border-control-border text-text rounded border px-3 py-1 text-sm"
        >
          {pending ? 'Saving…' : 'Save timezone'}
        </button>
      </form>

      {state && 'error' in state ? (
        <p className="text-bad-text mt-3 text-sm">{state.error}</p>
      ) : null}
      {state && 'saved' in state ? (
        <p className="text-ok-text mt-3 text-sm">
          Days are now measured in {state.saved}. Charts and totals re-draw on
          the next read.
        </p>
      ) : null}
    </>
  )
}
