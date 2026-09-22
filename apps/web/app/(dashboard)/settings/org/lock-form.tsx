'use client'

import { useActionState } from 'react'

import { setSeedLock } from './appearance-actions'

// Ticket 77: "chooses whether Members may override it". The design system's
// Switch, whose rule is that off is always the safe value — and here off is
// also the default, because an Org that never opens this page is one whose
// Members may choose.
//
// A lock keeps each Member's stored colour and stops applying it, rather than
// clearing it. A rebrand or a customer demo is often temporary, and unlocking
// should give everybody their choice back rather than make the whole Org pick
// again.

export function LockForm({
  orgId,
  locked,
}: {
  orgId: string
  locked: boolean
}) {
  const [state, formAction, pending] = useActionState(setSeedLock, null)

  return (
    <form action={formAction} className="mt-6">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="locked" value={locked ? 'off' : 'on'} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          Members may choose their own accent:{' '}
          <strong>{locked ? 'no' : 'yes'}</strong>
          <span className="text-text-secondary">
            {locked
              ? ' — everybody sees the Org’s colour. Light or dark is still theirs.'
              : ' — the Org’s colour is what somebody gets until they pick one.'}
          </span>
        </p>
        <button
          type="submit"
          disabled={pending}
          className="border-control-border text-text h-[var(--control-h)] rounded border px-3 text-sm"
        >
          {locked ? 'Let Members choose' : 'Lock the Org’s colour'}
        </button>
      </div>

      <div aria-live="polite">
        {state && 'error' in state ? (
          <p className="text-bad-text mt-3 text-sm">{state.error}</p>
        ) : null}
        {state && 'saved' in state ? (
          <p className="text-ok-text mt-3 text-sm">{state.saved}</p>
        ) : null}
      </div>
    </form>
  )
}
