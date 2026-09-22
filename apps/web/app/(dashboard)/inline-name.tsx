'use client'

import { useActionState, useCallback, useState } from 'react'

import { NAME_LIMIT } from '../../lib/names'

// Tickets 90 and 91, after Taha's second look at them: a pencil beside the
// name, a box in its place, a tick to save. Four surfaces name something — a
// machine, a Project, a Session, yourself — and a labelled form with a Save
// button on each of them turned every page into a settings screen.
//
// Nothing renders until the pencil is pressed, so a page of rows is a page of
// names rather than a page of inputs. The name shown is whatever the action
// last returned, so a save settles in place without a reload.
//
// Client-side for the reason every other write surface here is: a write
// refused by a policy touches nothing and raises nothing, so without the
// sentence underneath a refusal looks exactly like a save.

export type NameState = { error: string } | { saved: string | null } | null

export function InlineName({
  action,
  /**
   * The hidden fields the action needs, as a query string —
   * `projectId=…&memberId=…`. A string rather than an object because a fresh
   * object per row is a new prop identity on every render of a list.
   */
  hidden = '',
  /** What to show when there is no name: the key, the address, the id. */
  fallback,
  current,
  /** Names the control for a screen reader: "Name for the API". */
  label,
  placeholder,
  /** Renders the name itself in monospace, as a key is rendered. */
  mono = false,
}: {
  action: (previous: NameState, formData: FormData) => Promise<NameState>
  hidden?: string
  fallback: string
  current: string | null
  label: string
  placeholder: string
  mono?: boolean
}) {
  const [state, formAction, pending] = useActionState(action, null)
  const [editing, setEditing] = useState(false)
  const [handled, setHandled] = useState(state)

  // What the server last confirmed wins over what the page was rendered with,
  // so the name settles the moment the action returns rather than on the next
  // navigation.
  const saved = state && 'saved' in state ? state.saved : undefined
  const name = saved === undefined ? current : saved

  // Adjusted during the render that first sees a new result rather than in an
  // effect, which is React's own answer for state derived from a prop
  // changing: an effect would render the box once more before closing it. A
  // refused write keeps the box open with what was typed still in it; there is
  // nothing to correct on a success.
  if (handled !== state) {
    setHandled(state)
    if (state && 'saved' in state && editing) setEditing(false)
  }

  const open = useCallback(() => setEditing(true), [])
  const close = useCallback(() => setEditing(false), [])

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {editing ? (
        <form action={formAction} className="inline-flex items-center gap-1">
          {[...new URLSearchParams(hidden)].map(([field, value]) => (
            <input key={field} type="hidden" name={field} value={value} />
          ))}
          <label className="sr-only" htmlFor={`name-${label}`}>
            {label}
          </label>
          <input
            id={`name-${label}`}
            name="name"
            type="text"
            autoFocus
            maxLength={NAME_LIMIT}
            defaultValue={name ?? ''}
            placeholder={placeholder}
            className="border-control-border text-text min-w-0 rounded border px-2 py-1 text-base"
            // 16px or iOS zooms the page on focus, which on a phone is the
            // difference between an inline edit and losing your place.
            size={18}
          />
          <button
            type="submit"
            disabled={pending}
            aria-label="Save this name"
            title="Save"
            className="border-control-border text-text rounded border px-2 py-1 text-sm"
          >
            {pending ? '…' : '✓'}
          </button>
          <button
            type="button"
            onClick={close}
            aria-label="Stop renaming"
            title="Cancel"
            className="border-control-border text-text-muted rounded border px-2 py-1 text-sm"
          >
            ✕
          </button>
        </form>
      ) : (
        <>
          <span className={mono && !name ? 'font-mono break-all' : 'break-all'}>
            {name ?? fallback}
          </span>
          <button
            type="button"
            onClick={open}
            aria-label={label}
            title={name ? 'Rename' : 'Give this a name'}
            // A 32px target, which is the smallest a thumb finds reliably, on
            // a control that sits beside text rather than on its own row.
            className="text-text-muted hover:text-text -my-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-sm"
          >
            ✎
          </button>
        </>
      )}

      {/* Always in the DOM, so a screen reader is told what happened rather
          than having the sentence appear silently. */}
      <span
        role="status"
        aria-live="polite"
        className={
          state && 'error' in state
            ? 'text-bad-text text-caption'
            : 'text-text-muted text-caption'
        }
      >
        {state && 'error' in state ? state.error : ''}
      </span>
    </span>
  )
}
