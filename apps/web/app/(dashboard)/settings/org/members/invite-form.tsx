'use client'

import { useActionState } from 'react'

import { sendInvite } from './invite-actions'
import { Button, cardClass, inputClass } from '../../../../_ui/primitives'
import type { Delivery } from '../../../../../lib/mailer'

// What sits above the copyable link, given what delivery did (ticket 82). The
// link is shown in every case — it is the same token the email carries — so
// this only sets expectation: was it emailed, or must the inviter pass it on.
export const deliveryLine = (delivery: Delivery, email: string) => {
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
      {/* Direction A's field (ticket 113): the address and the Role in round
          fields, the primary button beside them. */}
      <form action={formAction} className="flex flex-wrap gap-1.5 py-1">
        <label className="sr-only" htmlFor="invite-email">
          Email
        </label>
        <input
          id="invite-email"
          type="email"
          name="email"
          required
          autoComplete="off"
          placeholder="name@company.com"
          className={`${inputClass} flex-1 basis-full sm:min-w-44 sm:basis-auto`}
        />
        <label className="sr-only" htmlFor="invite-role">
          Role
        </label>
        <select
          id="invite-role"
          name="role"
          defaultValue="member"
          className={`${inputClass} min-w-0 flex-1 sm:max-w-56 sm:flex-none`}
        >
          {ROLES.map((role) => (
            <option key={role.value} value={role.value}>
              {role.label} — {role.said}
            </option>
          ))}
        </select>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Inviting…' : 'Invite'}
        </Button>
      </form>

      <div role="status" aria-live="polite" className="mt-1">
        {state && 'error' in state ? (
          <p className="text-bad-text text-caption">{state.error}</p>
        ) : null}
        {state && 'link' in state ? (
          <div className={`${cardClass} mt-2`}>
            <p className="text-caption">
              {deliveryLine(state.delivery, state.email)}
            </p>
            {/* Readonly rather than text, so it is one tap to copy on a phone
                and cannot be edited into a link that goes nowhere. */}
            <input
              readOnly
              value={`${origin}${state.link}`}
              onFocus={select}
              className={`${inputClass} mt-2 w-full font-mono text-caption`}
            />
          </div>
        ) : null}
      </div>
    </>
  )
}

const select = (event: React.FocusEvent<HTMLInputElement>) =>
  event.currentTarget.select()
