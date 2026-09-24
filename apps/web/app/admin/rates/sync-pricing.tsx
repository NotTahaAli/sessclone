'use client'

import { useActionState } from 'react'

import { syncPricingAction } from './actions'
import { buttonClass } from '../../_ui/primitives'

// Ticket 97: fetch the published price list, approve each model's changes,
// apply the approved ones. Every model's changes are one checkbox, because a
// model's classes change together on the page and a half-applied model prices
// its cache reads from one list and its output from another.

const LABELS: Record<string, string> = {
  input: 'Input',
  output: 'Output',
  cache_write_5m: 'Cache write (5m)',
  cache_write_1h: 'Cache write (1h)',
  cache_read: 'Cache read',
}

const usd = (value: number | null) =>
  value === null ? 'unpriced' : `$${value}`

export function SyncPricing() {
  const [state, formAction, pending] = useActionState(syncPricingAction, null)

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div>
        <button
          type="submit"
          name="intent"
          value="fetch"
          disabled={pending}
          className={buttonClass()}
        >
          {pending ? 'Working…' : 'Fetch latest pricing'}
        </button>
        <p className="text-text-muted mt-1 text-caption">
          Reads Anthropic&rsquo;s published price list and lists what differs
          from this one. Nothing is published until you approve it.
        </p>
      </div>

      {state && 'proposals' in state ? (
        state.proposals.length === 0 ? (
          <p className="text-text-secondary text-caption">
            Every published model already matches this price list.
          </p>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {state.proposals.map((proposal) => (
                <li key={proposal.model} className="py-2">
                  <label className="flex items-baseline gap-2">
                    <input
                      type="checkbox"
                      name="model"
                      value={proposal.model}
                      defaultChecked
                    />
                    <span className="font-mono text-body">
                      {proposal.model}
                    </span>
                    {/* A model with no price yet is the one worth a second
                        look: its rows reach back to the epoch. */}
                    {proposal.changes.every(
                      (change) => change.from === null,
                    ) ? (
                      <span className="text-text-muted text-caption">
                        new model
                      </span>
                    ) : null}
                  </label>
                  <input
                    type="hidden"
                    name={`fingerprint:${proposal.model}`}
                    value={proposal.fingerprint}
                  />
                  <ul className="mt-1 flex flex-col gap-0.5 pl-6">
                    {proposal.changes.map((change) => (
                      <li key={change.class} className="text-caption">
                        {LABELS[change.class]}: {usd(change.from)} →{' '}
                        {usd(change.to)} per MTok
                        <span className="text-text-muted">
                          {' '}
                          · from {change.effectiveFrom}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
            <div>
              <button
                type="submit"
                name="intent"
                value="apply"
                disabled={pending}
                className={buttonClass('primary')}
              >
                Apply ticked
              </button>
            </div>
          </>
        )
      ) : null}

      <p role="status" aria-live="polite" className="text-caption">
        {state && 'error' in state ? (
          <span className="text-bad-text">{state.error}</span>
        ) : null}
        {state && 'applied' in state ? (
          <span className="text-text-secondary">
            Published {state.applied} prices for {state.models.join(', ')}.
          </span>
        ) : null}
      </p>
    </form>
  )
}
