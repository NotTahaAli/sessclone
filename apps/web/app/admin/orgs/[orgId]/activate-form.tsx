'use client'

import { useActionState } from 'react'

import { activateAction } from './actions'
import { buttonClass, inputClass } from '../../../_ui/primitives'

// Client-side for the refusal, as everywhere else: a write the policy refuses
// touches nothing and raises nothing, and a status that snapped back with no
// explanation would be the worst version of this page.

const STATUSES: { value: string; said: string }[] = [
  { value: 'active', said: 'entitled to everything the Tier includes' },
  { value: 'inactive', said: 'not activated yet' },
  { value: 'past_due', said: 'was active, payment has not arrived' },
  { value: 'cancelled', said: 'was active, has been stopped' },
]

/** Cents as the dollars the operator typed: `50000` as `500`. */
const dollarsOf = (cents: number | null) =>
  cents === null ? '' : String(cents / 100)

// Direction A's round field (2026-09-23 admin restyle).
const FIELD = inputClass

export function ActivateForm({
  orgId,
  tiers,
  tierId,
  status,
  priceBaseCents,
  priceSeatCents,
  retentionMaxDays,
}: {
  orgId: string
  tiers: { id: string; name: string; available: boolean }[]
  /** What the Org is on now, as two scalars: the form is a control, not a
   * copy of the row. */
  tierId: string | null
  status: string | null
  /** The agreed price, monthly US cents, or null. */
  priceBaseCents: number | null
  priceSeatCents: number | null
  /** Ticket 139: the contract's transcript retention ceiling, or null. */
  retentionMaxDays: number | null
}) {
  const [state, formAction, pending] = useActionState(activateAction, null)

  return (
    <>
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="orgId" value={orgId} />
        <label className="text-text-muted flex flex-col gap-1 text-caption">
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
                {tier.available ? tier.name : `${tier.name} (withdrawn)`}
              </option>
            ))}
          </select>
        </label>
        <label className="text-text-muted flex flex-col gap-1 text-caption">
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
        <label className="text-text-muted flex flex-col gap-1 text-caption">
          Agreed base, $/month
          <input
            name="priceBase"
            inputMode="decimal"
            autoComplete="off"
            placeholder="none"
            defaultValue={dollarsOf(priceBaseCents)}
            className={`${FIELD} w-32`}
          />
        </label>
        <label className="text-text-muted flex flex-col gap-1 text-caption">
          Agreed $/seat/month
          <input
            name="priceSeat"
            inputMode="decimal"
            autoComplete="off"
            placeholder="none"
            defaultValue={dollarsOf(priceSeatCents)}
            className={`${FIELD} w-32`}
          />
        </label>
        <label className="text-text-muted flex flex-col gap-1 text-caption">
          Transcript retention cap, days
          <input
            name="retentionMaxDays"
            inputMode="numeric"
            autoComplete="off"
            placeholder="Tier's"
            defaultValue={retentionMaxDays ?? ''}
            className={`${FIELD} w-32`}
          />
        </label>
        <label className="text-text-muted flex grow flex-col gap-1 text-caption">
          Note
          <input
            name="note"
            autoComplete="off"
            placeholder="invoice INV-2026-014, paid by transfer"
            className={FIELD}
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className={buttonClass('primary')}
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
      </form>

      <p role="status" aria-live="polite" className="mt-3 text-caption">
        {state && 'error' in state ? (
          <span className="text-bad-text">{state.error}</span>
        ) : null}
        {state && 'saved' in state ? (
          <span className="text-text-secondary">
            {state.saved === 'recorded'
              ? 'Saved. The history below is the record.'
              : 'Nothing changed, so nothing was recorded — and the note went nowhere.'}
          </span>
        ) : null}
      </p>
    </>
  )
}
