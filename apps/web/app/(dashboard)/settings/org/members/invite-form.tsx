'use client'

import { useActionState } from 'react'

import { sendInvite } from './invite-actions'
import type { Delivery } from '../../../../../lib/mailer'

// What sits above the copyable link, given what delivery did (ticket 82). The
// link is shown in every case — it is the same token the email carries — so
// this only sets expectation: was it emailed, or must the inviter pass it on.
const deliveryLine = (delivery: Delivery, email: string) => {
  const suffix =
    ' The link is shown once, works for seven days, and only works for that address.'
  if (delivery === 'sent') {
    return `Invitation emailed to ${email}. You can also send this link yourself.${suffix}`
  }
  const why =
    delivery === 'not-configured'
      ? 'This deployment does not send email'
      : 'The email could not be sent'
  return `${why}, so send ${email} this link yourself.${suffix}`
}

// Client-side because the link is the result. A Server Action that only
// revalidated would leave the one thing the inviter needs — the URL to send —
// nowhere on the page, and it cannot be fetched again later: the token is
// stored as a hash and this is the only time it exists in plain text.

const ROLES: { value: string; label: string; said: string }[] = [
  { value: 'member', label: 'Member', said: 'sees their own usage' },
  { value: 'manager', label: 'Manager', said: 'sees the people you assign' },
  { value: 'admin', label: 'Admin', said: 'the whole Org, except billing' },
]

export function InviteForm({ origin }: { origin: string }) {
  const [state, formAction, pending] = useActionState(sendInvite, null)

  return (
    <>
      <form action={formAction} className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-caption">
          Email
          <input
            type="email"
            name="email"
            required
            autoComplete="off"
            placeholder="person@example.com"
            className="border-control-border text-text rounded border px-3 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-caption">
          Role
          <select
            name="role"
            defaultValue="member"
            className="border-control-border text-text rounded border px-3 py-1 text-sm"
          >
            {ROLES.map((role) => (
              <option key={role.value} value={role.value}>
                {role.label} — {role.said}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={pending}
          className="border-control-border text-text rounded border px-3 py-1 text-sm"
        >
          {pending ? 'Inviting…' : 'Invite'}
        </button>
      </form>

      <div role="status" aria-live="polite" className="mt-3">
        {state && 'error' in state ? (
          <p className="text-bad-text text-sm">{state.error}</p>
        ) : null}
        {state && 'link' in state ? (
          <div className="border-rule bg-surface rounded-md border p-3">
            <p className="text-sm">
              {deliveryLine(state.delivery, state.email)}
            </p>
            {/* Readonly rather than text, so it is one tap to copy on a phone
                and cannot be edited into a link that goes nowhere. */}
            <input
              readOnly
              value={`${origin}${state.link}`}
              onFocus={select}
              className="border-control-border text-text mt-2 w-full rounded border px-3 py-1 font-mono text-caption"
            />
          </div>
        ) : null}
      </div>
    </>
  )
}

const select = (event: React.FocusEvent<HTMLInputElement>) =>
  event.currentTarget.select()
