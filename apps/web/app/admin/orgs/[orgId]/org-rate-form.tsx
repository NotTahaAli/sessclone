'use client'

import { useActionState, useCallback } from 'react'

import { addOrgRateAction, deleteOrgRateAction } from './rate-actions'
import { RATE_CLASSES, rateUnit, type RateClass } from '../../../../lib/rates'

// Client-side for the refusal and the confirmation, as everywhere else in the
// admin area: a write the policy refuses touches nothing and raises nothing,
// and a form that reset itself with no explanation would be the worst version
// of a page about somebody's invoice.

const LABELS: Record<RateClass, string> = {
  input: 'Input',
  output: 'Output',
  cache_write_5m: 'Cache write (5m)',
  cache_write_1h: 'Cache write (1h)',
  cache_read: 'Cache read',
  web_search_request: 'Web search',
  web_fetch_request: 'Web fetch',
}

const FIELD = 'border-control-border text-text rounded border px-3 py-1 text-sm'

export function AddOrgRateForm({
  orgId,
  today,
  models,
  action = addOrgRateAction,
}: {
  orgId: string
  /** Resolved on the server, so the form does not render one date and hydrate
   * another. */
  today: string
  /** The models the platform list prices, so a typo is visible before it is
   * saved: an override naming a model nothing reports prices nothing, and
   * looks exactly like one that works. */
  models: string[]
  /** The Org's own settings page (ticket 121) posts to its own action, gated
   * on the Org rather than on the platform flag. */
  action?: typeof addOrgRateAction
}) {
  const [state, formAction, pending] = useActionState(action, null)

  return (
    <>
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="orgId" value={orgId} />
        <label className="flex flex-col gap-1 text-caption">
          Model
          <input
            name="model"
            list="priced-models"
            autoComplete="off"
            placeholder="claude-opus-4-6"
            className={`${FIELD} font-mono`}
          />
          <datalist id="priced-models">
            {models.map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
        </label>
        <label className="flex flex-col gap-1 text-caption">
          Class
          <select name="class" defaultValue="input" className={FIELD}>
            {RATE_CLASSES.map((rateClass) => (
              <option key={rateClass} value={rateClass}>
                {LABELS[rateClass]} · {rateUnit(rateClass)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-caption">
          Price USD
          <input
            name="priceUsd"
            type="number"
            step="any"
            min="0"
            required
            className={FIELD}
          />
        </label>
        <label className="flex flex-col gap-1 text-caption">
          From
          <input
            name="effectiveFrom"
            type="date"
            defaultValue={today}
            required
            className={FIELD}
          />
        </label>
        <label className="flex grow flex-col gap-1 text-caption">
          Note
          <input
            name="note"
            autoComplete="off"
            placeholder="MSA 2026-03, schedule B"
            className={FIELD}
          />
        </label>
        <button type="submit" disabled={pending} className={FIELD}>
          {pending ? 'Saving…' : 'Set price'}
        </button>
      </form>

      <p role="status" aria-live="polite" className="mt-3 text-caption">
        {state && 'error' in state ? (
          <span className="text-bad-text">{state.error}</span>
        ) : null}
        {state && 'added' in state ? (
          <span className="text-text-secondary">
            Saved for {state.added}. This Org’s Turns reprice on the next read.
          </span>
        ) : null}
      </p>
    </>
  )
}

export function DeleteOrgRate({
  orgId,
  rateId,
  said,
  action = deleteOrgRateAction,
}: {
  orgId: string
  rateId: string
  /** What is being deleted, for the confirmation and the screen reader. */
  said: string
  action?: typeof deleteOrgRateAction
}) {
  const [state, formAction, pending] = useActionState(action, null)

  // Native `confirm`, which is one line and works on a phone. Deleting an
  // override moves this Org back to the published price for every Turn it
  // covered, on the next read and with no further warning.
  const ask = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (
        !confirm(`Delete the ${said}? This Org's Turns go back to list price.`)
      ) {
        event.preventDefault()
      }
    },
    [said],
  )

  return (
    <form action={formAction} className="mt-1">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="rateId" value={rateId} />
      <button
        type="submit"
        disabled={pending}
        onClick={ask}
        className="text-text-muted text-caption underline"
      >
        {pending ? 'Deleting…' : 'Delete'}
        <span className="sr-only"> {said}</span>
      </button>
      <span role="status" aria-live="polite" className="text-caption">
        {state && 'error' in state ? (
          <span className="text-bad-text"> {state.error}</span>
        ) : null}
      </span>
    </form>
  )
}
