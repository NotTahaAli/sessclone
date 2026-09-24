'use client'

import { useActionState } from 'react'

import { saveTierAction } from './actions'
import { buttonClass, inputClass } from '../../_ui/primitives'

// One form per Tier, plus one empty one for a new Tier. Client-side for the
// refusal and for the saved line, as everywhere else in the admin area.
//
// Every field is a column. There is deliberately no "plan type" control and no
// list of features to tick: ADR 0004 makes the next gate a row, so the gates
// are a JSON field an operator types into rather than a form that has to be
// redeployed to learn a new key.

// Direction A's round field (2026-09-23 admin restyle).
const FIELD = inputClass

export type TierValues = {
  key: string
  name: string
  description: string | null
  basePriceUsd: number | null
  seatPriceUsd: number | null
  includedSeats: number
  minSeats: number | null
  maxSeats: number | null
  retentionMaxDays: number | null
  archivalAvailable: boolean
  features: Record<string, unknown>
  sortOrder: number
  available: boolean
}

export function TierForm({
  tier,
  orgs,
}: {
  /** Absent for the new-Tier form. */
  tier?: TierValues
  /** How many Orgs are on it, so an edit is made with that in view. */
  orgs?: number
}) {
  const [state, formAction, pending] = useActionState(saveTierAction, null)

  return (
    <form action={formAction} className="flex flex-col gap-3 py-2">
      {/* Which form this is. The action refuses a create whose key is taken,
          rather than replacing a Tier every Org on it is entitled by. */}
      <input type="hidden" name="mode" value={tier ? 'edit' : 'create'} />
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Key" hint="stable across renames">
          <input
            name="key"
            required
            defaultValue={tier?.key}
            readOnly={Boolean(tier)}
            pattern="[a-z0-9_]+"
            className={`${FIELD} font-mono ${tier ? 'text-text-muted' : ''}`}
          />
        </Field>
        <Field label="Name">
          <input
            name="name"
            required
            defaultValue={tier?.name}
            className={FIELD}
          />
        </Field>
        <Field label="Order">
          <input
            name="sortOrder"
            type="number"
            min="0"
            defaultValue={tier?.sortOrder ?? 0}
            className={`${FIELD} w-20`}
          />
        </Field>
      </div>

      <Field label="Description">
        <input
          name="description"
          defaultValue={tier?.description ?? ''}
          className={`${FIELD} w-full`}
        />
      </Field>

      <div className="flex flex-wrap items-end gap-3">
        {/* Empty is null, and null in both is "contact us" — a real Tier, not
            a missing price. */}
        <Field label="Base $/month" hint="empty for none">
          <input
            name="basePriceUsd"
            type="number"
            step="0.01"
            min="0"
            defaultValue={tier?.basePriceUsd ?? ''}
            className={`${FIELD} w-28`}
          />
        </Field>
        <Field label="Seat $/month" hint="empty for none">
          <input
            name="seatPriceUsd"
            type="number"
            step="0.01"
            min="0"
            defaultValue={tier?.seatPriceUsd ?? ''}
            className={`${FIELD} w-28`}
          />
        </Field>
        <Field label="Included seats">
          <input
            name="includedSeats"
            type="number"
            min="0"
            defaultValue={tier?.includedSeats ?? 0}
            className={`${FIELD} w-24`}
          />
        </Field>
        <Field label="Min seats" hint="empty for none">
          <input
            name="minSeats"
            type="number"
            min="1"
            defaultValue={tier?.minSeats ?? ''}
            className={`${FIELD} w-24`}
          />
        </Field>
        <Field label="Max seats" hint="empty for no limit">
          <input
            name="maxSeats"
            type="number"
            min="1"
            defaultValue={tier?.maxSeats ?? ''}
            className={`${FIELD} w-24`}
          />
        </Field>
        <Field label="Retention cap (days)" hint="empty for no ceiling">
          <input
            name="retentionMaxDays"
            type="number"
            min="1"
            defaultValue={tier?.retentionMaxDays ?? ''}
            className={`${FIELD} w-28`}
          />
        </Field>
      </div>

      <Field label="Features" hint="JSON object, one key per gate">
        <input
          name="features"
          defaultValue={JSON.stringify(tier?.features ?? {})}
          className={`${FIELD} w-full font-mono`}
        />
      </Field>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-caption">
          <input
            type="checkbox"
            name="archivalAvailable"
            defaultChecked={tier?.archivalAvailable ?? false}
          />
          Archival available
        </label>
        <label className="flex items-center gap-2 text-caption">
          <input
            type="checkbox"
            name="available"
            defaultChecked={tier?.available ?? true}
          />
          On sale
        </label>
        <button
          type="submit"
          disabled={pending}
          className={buttonClass('primary')}
        >
          {pending ? 'Saving…' : tier ? 'Save' : 'Create Tier'}
        </button>
        {orgs ? (
          <span className="text-text-muted text-caption">
            {orgs} {orgs === 1 ? 'Org is' : 'Orgs are'} on this Tier
          </span>
        ) : null}
      </div>

      <p role="status" aria-live="polite" className="text-caption">
        {state && 'error' in state ? (
          <span className="text-bad-text">{state.error}</span>
        ) : null}
        {state && 'saved' in state ? (
          <span className="text-text-secondary">
            Saved. {state.saved} takes effect on the next read.
          </span>
        ) : null}
      </p>
    </form>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="text-text-muted flex flex-col gap-1 text-caption">
      <span>
        {label}
        {hint ? <span className="text-text-muted"> · {hint}</span> : null}
      </span>
      {children}
    </label>
  )
}
