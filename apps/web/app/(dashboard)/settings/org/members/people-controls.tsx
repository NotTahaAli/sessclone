'use client'

import { useActionState } from 'react'

import { changeMembership, changeRole } from './invite-actions'

// Ticket 50's two controls, as one client component per person.
//
// Client-side for the refusal, as everywhere else on this page: a write the
// policy refuses touches nothing and raises nothing, and the last-Owner rule
// raises a sentence the page has to show rather than throw. Without it, an
// Admin demoting the only Owner would see the Role snap back with no
// explanation at all.

const ROLES = ['owner', 'admin', 'manager', 'member']

export function PersonControls({
  memberId,
  role,
  who,
  removed,
}: {
  memberId: string
  role: string
  /** Who the controls act on, for a screen reader: their name, else address. */
  who: string
  removed: boolean
}) {
  const [state, action, pending] = useActionState(run, null)

  return (
    <div className="flex flex-col items-end gap-2">
      <form action={action} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="memberId" value={memberId} />
        <label className="sr-only" htmlFor={`role-${memberId}`}>
          Role for {who}
        </label>
        {/* A select and a button rather than a select that submits itself: a
            Role change is not something to do by scrolling past a control. */}
        <select
          id={`role-${memberId}`}
          name="role"
          defaultValue={role}
          disabled={removed}
          className="border-control-border text-text rounded border px-2 py-1 text-sm"
        >
          {ROLES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <button
          type="submit"
          name="intent"
          value="role"
          disabled={pending || removed}
          className="border-control-border text-text rounded border px-3 py-1 text-sm"
        >
          Save
        </button>
        <button
          type="submit"
          name="intent"
          value={removed ? 'readmit' : 'remove'}
          disabled={pending}
          className="border-control-border text-text rounded border px-3 py-1 text-sm whitespace-nowrap"
        >
          {removed ? 'Re-admit' : 'Remove'}
          <span className="sr-only"> {who}</span>
        </button>
      </form>

      <p
        role="status"
        aria-live="polite"
        className="text-bad-text text-caption"
      >
        {state?.error ?? ''}
      </p>
    </div>
  )
}

/**
 * Which of the two writes the pressed button asked for.
 *
 * One form, because the Role select belongs to it and a second form would
 * have to duplicate the hidden id; `intent` is the submitter's own value,
 * which is what a browser sends for the button that was actually pressed.
 */
const run = async (_previous: unknown, formData: FormData) => {
  const intent = formData.get('intent')
  if (intent === 'role') return changeRole(formData)

  formData.set('to', intent === 'remove' ? 'removed' : 'active')
  return changeMembership(formData)
}
