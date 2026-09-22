'use client'

import { useActionState } from 'react'

import { setSessionStateAction, type ShelfState } from './actions'
import type { SessionState } from '../../../../lib/names'

// Ticket 92: which shelf this Session sits on, and the two buttons that move
// it.
//
// Client-side for the reason every other write surface here is, and the one
// `InlineName` states: a write refused by a policy touches nothing and raises
// nothing, so without the sentence underneath a refusal looks exactly like a
// success.
//
// Two buttons rather than a `select` and a Save: there are three states and
// two of them are one press away from wherever the reader is. The third —
// back on the list — is the same press again, which is what makes each button
// a toggle rather than a setting.
//
// What it does *not* say anywhere on it is anything about money. Nothing here
// moves a Turn, so a sentence promising that would be answering a question the
// reader has not asked and inviting the doubt it was meant to settle.

const LABEL: Record<string, string> = {
  archived:
    'Archived. It is off the Sessions list until somebody asks for the archived ones.',
  hidden: 'Hidden. It is on no list at all; this link is the way back to it.',
}

export function Shelf({
  memberId,
  sessionId,
  current,
}: {
  memberId: string
  sessionId: string
  current: SessionState | null
}) {
  const [result, submit, pending] = useActionState<ShelfState, FormData>(
    setSessionStateAction,
    {},
  )

  // Whatever the action last returned, falling back to what the page was
  // rendered with — so a press settles in place rather than waiting on a
  // reload, and a refusal leaves the old state showing rather than the one
  // that was refused.
  const state = result.error ? current : (result.state ?? current)
  const note = state ? LABEL[state] : null

  return (
    <form action={submit} className="flex flex-col gap-2">
      <input type="hidden" name="memberId" value={memberId} />
      <input type="hidden" name="sessionId" value={sessionId} />

      <div className="flex flex-wrap gap-2">
        {button('archived', state, pending)}
        {button('hidden', state, pending)}
      </div>

      {note ? (
        <p className="text-text-muted text-caption">{note}</p>
      ) : (
        <p className="text-text-muted text-caption">
          On the Sessions list. Archiving takes it off that list; hiding takes
          it off every list. Neither changes what it cost.
        </p>
      )}

      {result.error ? (
        <p role="alert" className="text-bad-text text-caption">
          {result.error}
        </p>
      ) : null}
    </form>
  )
}

/**
 * One toggle. Pressing the shelf a Session is already on puts it back on the
 * list, which is why the value posted depends on the state rather than on the
 * button.
 *
 * A function returning markup rather than a component, for the reason
 * `filters.tsx` gives: called twice, written once, and no fresh props object
 * per render.
 */
const button = (
  shelf: SessionState,
  state: SessionState | null,
  pending: boolean,
) => {
  const on = state === shelf
  const verb = shelf === 'archived' ? 'Archive' : 'Hide'

  return (
    <button
      type="submit"
      name="state"
      value={on ? 'listed' : shelf}
      disabled={pending}
      aria-pressed={on}
      className={`border-control-border h-8 rounded border px-3 text-caption disabled:opacity-60 ${
        on ? 'bg-surface-hover text-text' : 'text-text-secondary'
      }`}
    >
      {on ? `Put back on the list` : verb}
    </button>
  )
}
