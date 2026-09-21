'use client'

import { useActionState } from 'react'

import { activateAction } from './actions'

// Client-side for the refusal, as everywhere else: a write the policy refuses
// touches nothing and raises nothing, and a status that snapped back with no
// explanation would be the worst version of this page.

const STATUSES: { value: string; said: string }[] = [
  { value: 'active', said: 'entitled to everything the Tier includes' },
  { value: 'inactive', said: 'not activated yet' },
  { value: 'past_due', said: 'was active, payment has not arrived' },
  { value: 'cancelled', said: 'was active, has been stopped' },
]

const FIELD = 'border-control-border text-text rounded border px-3 py-1 text-sm'

export function ActivateForm({
  orgId,
  tiers,
  tierId,
  status,
}: {
  orgId: string
  tiers: { id: string; name: string }[]
  /** What the Org is on now, as two scalars: the form is a control, not a
   * copy of the row. */
  tierId: string | null
  status: string | null
}) {
  const [state, formAction, pending] = useActionState(activateAction, null)

  return (
    <>
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="orgId" value={orgId} />
        <label className="flex flex-col gap-1 text-caption">
          Tier
          <select
            name="tierId"
            defaultValue={tierId ?? ''}
            required
            className={FIELD}
          >
            <option value="" disabled>
              Pick one
            </option>
            {tiers.map((tier) => (
              <option key={tier.id} value={tier.id}>
                {tier.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-caption">
          Status
          <select
            name="status"
            defaultValue={status ?? 'active'}
            className={FIELD}
          >
            {STATUSES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.value} — {option.said}
              </option>
            ))}
          </select>
        </label>
        <label className="flex grow flex-col gap-1 text-caption">
          Note
          <input
            name="note"
            autoComplete="off"
            placeholder="invoice INV-2026-014, paid by transfer"
            className={FIELD}
          />
        </label>
        <button type="submit" disabled={pending} className={FIELD}>
          {pending ? 'Saving…' : 'Save'}
        </button>
      </form>

      <p role="status" aria-live="polite" className="mt-3 text-caption">
        {state && 'error' in state ? (
          <span className="text-bad-text">{state.error}</span>
        ) : null}
        {state && 'saved' in state ? (
          <span className="text-text-secondary">
            Saved. The history below is the record.
          </span>
        ) : null}
      </p>
    </>
  )
}
