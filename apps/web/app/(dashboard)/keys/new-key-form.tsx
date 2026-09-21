'use client'

import { useActionState, useCallback, useState } from 'react'

import { createKey } from './actions'
import type { Membership } from '../../../lib/api-keys'

// The one client component on this page, and it is client-side for exactly one
// reason: the new key lives in `useActionState`'s return value and nowhere
// else. A Server Component cannot hold it — there is nothing to re-read it
// from on the next render, which is the point.

export function NewKeyForm({ memberships }: { memberships: Membership[] }) {
  const [state, formAction, pending] = useActionState(createKey, null)

  // Only when there is a choice. One membership is the common case and a
  // one-option select is a control that asks a question with one answer.
  const choose = memberships.length > 1

  return (
    <section className="border-rule mt-8 border-t pt-6">
      <h2 className="text-text text-lg font-medium">Create a key</h2>

      <form action={formAction} className="mt-3 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="label" className="text-text-muted text-xs">
            Label
          </label>
          <input
            id="label"
            name="label"
            required
            maxLength={80}
            placeholder="work laptop"
            className="border-control-border bg-surface text-text rounded border px-3 py-2"
          />
        </div>
        {choose ? (
          <div className="flex flex-col gap-1">
            <label htmlFor="memberId" className="text-text-muted text-xs">
              Org
            </label>
            <select
              id="memberId"
              name="memberId"
              required
              defaultValue=""
              className="border-control-border bg-surface text-text rounded border px-3 py-2"
            >
              <option value="" disabled>
                Choose an org
              </option>
              {memberships.map((membership) => (
                <option key={membership.member_id} value={membership.member_id}>
                  {membership.org_name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="border-accent-border bg-accent-fill text-accent-on-fill rounded border px-3 py-2"
        >
          {pending ? 'Creating…' : 'Create key'}
        </button>
      </form>

      {state && 'error' in state ? (
        <p role="alert" className="text-bad-text mt-3 text-sm">
          {state.error}
        </p>
      ) : null}

      {state && 'key' in state ? <Revealed apiKey={state.key} /> : null}
    </section>
  )
}

/**
 * Shown once, on the render that created it. Navigating away or reloading
 * loses it, and that is not a bug to fix later — nothing stored it.
 */
function Revealed({ apiKey }: { apiKey: string }) {
  const [copied, setCopied] = useState(false)

  const copy = useCallback(() => {
    // Unavailable over plain HTTP and refusable by the browser, so the key
    // stays on screen to select by hand either way.
    navigator.clipboard?.writeText(apiKey).then(
      () => setCopied(true),
      () => setCopied(false),
    )
  }, [apiKey])

  return (
    <div
      role="status"
      className="border-ok-border bg-ok-bg mt-4 rounded border p-4"
    >
      <p className="text-text text-sm font-medium">
        Copy this key now. It is not stored and cannot be shown again.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <code className="border-rule bg-surface text-text rounded border px-3 py-2 font-mono text-sm break-all">
          {apiKey}
        </code>
        <button
          type="button"
          onClick={copy}
          className="border-control-border text-text rounded border px-3 py-2"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  )
}
