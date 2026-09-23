'use client'

import { useActionState, useCallback, useState, type ChangeEvent } from 'react'

import { changeMembership, changeRole } from './invite-actions'
import { inputClass } from '../../../../_ui/primitives'

// Ticket 50's two controls, as one client component per person.
//
// Client-side for the refusal, as everywhere else on this page: a write the
// policy refuses touches nothing and raises nothing, and the last-Owner rule
// raises a sentence the page has to show rather than throw. Without it, an
// Admin demoting the only Owner would see the Role snap back with no
// explanation at all.
//
// Ticket 113 draws the Role as a pill in the person's row. It still does not
// save itself on change — a Role change is not something to do by scrolling
// past a control — so a Save appears beside it once a different Role is
// picked, and only then.

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
  const [picked, setPicked] = useState(role)
  const [shown, setShown] = useState(role)

  // The page re-renders with the saved Role; the pill follows it.
  if (shown !== role) {
    setShown(role)
    setPicked(role)
  }

  const pick = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => setPicked(event.target.value),
    [],
  )

  return (
    <div className="flex flex-col items-end gap-0.5">
      <form action={action} className="flex items-center gap-1.5">
        <input type="hidden" name="memberId" value={memberId} />
        <label className="sr-only" htmlFor={`role-${memberId}`}>
          Role for {who}
        </label>
        <select
          id={`role-${memberId}`}
          name="role"
          value={picked}
          onChange={pick}
          disabled={removed}
          className={`${inputClass} h-7 pr-2 text-caption capitalize`}
        >
          {ROLES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        {picked === role ? null : (
          <button
            type="submit"
            name="intent"
            value="role"
            disabled={pending || removed}
            className="bg-text text-ground inline-flex h-7 items-center rounded-full px-3 text-caption font-medium"
          >
            Save
          </button>
        )}
        <button
          type="submit"
          name="intent"
          value={removed ? 'readmit' : 'remove'}
          disabled={pending}
          className="text-text-muted hover:text-text text-caption underline"
        >
          {removed ? 'Re-admit' : 'Remove'}
          <span className="sr-only"> {who}</span>
        </button>
      </form>

      <p
        role="status"
        aria-live="polite"
        className="text-bad-text text-right text-caption"
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
