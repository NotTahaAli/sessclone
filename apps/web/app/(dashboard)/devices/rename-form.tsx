'use client'

import { useActionState } from 'react'

import { rename } from './actions'

// Client-side for the same reason the timezone form is: the answer to "did
// that save" lives in `useActionState`'s return value, and a rename refused by
// the policy writes nothing and raises nothing. Without the sentence the page
// would look like it worked.

export function RenameForm({
  deviceId,
  nickname,
  deviceKey,
}: {
  deviceId: string
  nickname: string | null
  deviceKey: string
}) {
  const [state, formAction, pending] = useActionState(rename, null)

  return (
    <>
      <form action={formAction} className="mt-3 flex flex-wrap gap-2">
        <input type="hidden" name="deviceId" value={deviceId} />
        <label className="sr-only" htmlFor={`nickname-${deviceId}`}>
          Name for {deviceKey}
        </label>
        <input
          id={`nickname-${deviceId}`}
          name="nickname"
          type="text"
          maxLength={60}
          defaultValue={nickname ?? ''}
          placeholder="Work laptop"
          className="border-control-border text-text min-w-0 flex-1 rounded border px-3 py-1 text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="border-control-border text-text rounded border px-3 py-1 text-sm"
        >
          {pending ? 'Saving…' : 'Save name'}
        </button>
      </form>

      {state && 'error' in state ? (
        <p className="text-bad-text mt-2 text-sm">{state.error}</p>
      ) : null}
      {state && 'saved' in state ? (
        <p className="text-ok-text mt-2 text-sm">
          {state.saved === null
            ? 'Name cleared. This machine shows as its key again.'
            : `Saved. This machine is “${state.saved}” everywhere it appears.`}
        </p>
      ) : null}
    </>
  )
}
