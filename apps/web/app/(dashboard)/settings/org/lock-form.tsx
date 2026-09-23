'use client'

import { useActionState, useCallback, type ChangeEvent } from 'react'

import { setSeedLock } from './appearance-actions'
import { Switch } from '../../../_ui/primitives'

// Ticket 77: "chooses whether Members may override it". The design system's
// Switch, whose rule is that off is always the safe value.
//
// Ticket 113 words the row the positive way the approved design does —
// "Members choose their own", on by default — and saves when flipped. On means
// not locked, so the form posts `locked` as the state moved to, exactly as the
// button it replaces did.
//
// A lock keeps each Member's stored colour and stops applying it, rather than
// clearing it: a rebrand or a demo is often temporary, and unlocking gives
// everybody their choice back.

export function LockForm({
  orgId,
  locked,
}: {
  orgId: string
  locked: boolean
}) {
  const [state, formAction, pending] = useActionState(setSeedLock, null)

  const submit = useCallback(
    (event: ChangeEvent<HTMLInputElement>) =>
      event.currentTarget.form?.requestSubmit(),
    [],
  )

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="locked" value={locked ? 'off' : 'on'} />
      {/* Remounted on the server's answer, so a refused write springs back. */}
      <Switch
        key={String(locked)}
        defaultChecked={!locked}
        onChange={submit}
        disabled={pending}
        aria-label="Members may choose their own accent"
      />
      <div aria-live="polite" className="text-right text-caption">
        {state && 'error' in state ? (
          <p className="text-bad-text">{state.error}</p>
        ) : null}
      </div>
    </form>
  )
}
