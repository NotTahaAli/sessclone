'use client'

import { useActionState, useCallback, useRef } from 'react'

import { addRateAction } from './actions'
import { RATE_CLASSES, rateUnit, type RateClass } from '../../../lib/rates'

// Client-side for two reasons, both of which a Server Action alone cannot do:
// the refusal is a sentence rather than an error boundary, and a model that
// cannot be priced is one tap away from being filled into this form — which is
// the whole reason the unknown-model list lives on this page rather than on a
// page of its own.

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

export function AddRateForm({
  today,
  unknown,
  moreUnknown,
}: {
  /** The operator's default effective date, resolved on the server so the form
   * does not render one date and hydrate another. */
  today: string
  unknown: { model: string | null; turns: number }[]
  /** The list is cut: a Collector sends whatever model string it likes. */
  moreUnknown: boolean
}) {
  const [state, formAction, pending] = useActionState(addRateAction, null)
  const model = useRef<HTMLInputElement>(null)

  // One handler on the list rather than one per chip: the chips are data, and
  // a closure per row is a new prop on every render.
  const fill = useCallback((event: React.MouseEvent<HTMLUListElement>) => {
    const clicked = event.target
    const button = clicked instanceof Element ? clicked.closest('button') : null
    const field = model.current
    if (!button || !field) return
    field.value = button.dataset.model ?? ''
    field.focus()
  }, [])

  return (
    <>
      {unknown.length > 0 ? (
        <div className="mb-4">
          <p className="text-text-secondary text-caption">
            Collected but not priced. Pick one to fill it in below — publishing
            a price prices the Turns already waiting for it, with nothing to
            run.
          </p>
          <ul onClick={fill} className="mt-2 flex flex-wrap gap-2">
            {unknown.map((row) => (
              <li key={row.model ?? 'unnamed'}>
                <button
                  type="button"
                  data-model={row.model ?? ''}
                  className="border-control-border rounded border px-3 py-1 font-mono text-caption"
                >
                  {row.model ?? 'no model'}
                  <span className="text-text-muted font-sans">
                    {' '}
                    · {row.turns.toLocaleString()} turns
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {moreUnknown ? (
            <p className="text-text-muted mt-2 text-caption">
              Only the 50 most-collected are shown.
            </p>
          ) : null}
        </div>
      ) : null}

      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-caption">
          Model
          <input
            ref={model}
            name="model"
            autoComplete="off"
            placeholder="claude-opus-5"
            className={`${FIELD} font-mono`}
          />
        </label>
        <label className="flex flex-col gap-1 text-caption">
          Class
          <select name="class" defaultValue="input" className={FIELD}>
            {RATE_CLASSES.map((value) => (
              <option key={value} value={value}>
                {LABELS[value]} — {rateUnit(value)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-caption">
          Price (USD)
          <input
            name="priceUsd"
            type="number"
            step="0.000001"
            min="0"
            required
            inputMode="decimal"
            className={FIELD}
          />
        </label>
        <label className="flex flex-col gap-1 text-caption">
          Effective from
          <input
            name="effectiveFrom"
            type="date"
            required
            defaultValue={today}
            className={FIELD}
          />
        </label>
        <label className="flex flex-col gap-1 text-caption">
          Source
          <input
            name="source"
            autoComplete="off"
            placeholder="published price list, read today"
            className={FIELD}
          />
        </label>
        <button type="submit" disabled={pending} className={FIELD}>
          {pending ? 'Publishing…' : 'Publish'}
        </button>
      </form>

      <p role="status" aria-live="polite" className="mt-3 text-caption">
        {state && 'error' in state ? (
          <span className="text-bad-text">{state.error}</span>
        ) : null}
        {state && 'added' in state ? (
          <span className="text-text-secondary">
            Published. {state.added} is priced from that date on.
          </span>
        ) : null}
      </p>
    </>
  )
}
