'use client'

import { useCallback, type ChangeEvent } from 'react'

import { Switch } from '../../_ui/primitives'

// Ticket 113: an on/off setting is a switch in its row, saved the moment it
// is flipped — no Save button for one value. The form still posts the same
// fields the button it replaces posted, `to` being the state moved to rather
// than a toggle, so two flips of a stale page land on the same setting rather
// than flipping it twice.
//
// The switch shows its new position at once (it is a real checkbox); the
// action revalidates the page, and the `key` below remounts it on the
// server's answer, so a refused write springs back rather than lying.

export function SwitchForm({
  action,
  hidden,
  checked,
  label,
}: {
  action: (formData: FormData) => void | Promise<void>
  /** The fields the action needs, as a query string — a string rather than
   * an object so a list of rows does not build one per render. */
  hidden: string
  checked: boolean
  /** Names the switch for a screen reader: "Archive transcripts for Acme". */
  label: string
}) {
  const submit = useCallback(
    (event: ChangeEvent<HTMLInputElement>) =>
      event.currentTarget.form?.requestSubmit(),
    [],
  )

  return (
    <form action={action} className="flex">
      {[...new URLSearchParams(hidden)].map(([field, value]) => (
        <input key={field} type="hidden" name={field} value={value} />
      ))}
      <input type="hidden" name="to" value={checked ? 'off' : 'on'} />
      <Switch
        key={String(checked)}
        defaultChecked={checked}
        onChange={submit}
        aria-label={label}
      />
    </form>
  )
}
