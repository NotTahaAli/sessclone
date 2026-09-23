'use client'

import { useActionState } from 'react'

import { setOwnTheme } from './appearance-actions'
import type { Theme } from '../../../../lib/appearance'

// Ticket 77's SegmentedControl, which the design system's inventory scopes to
// exactly this: "Two to four options. Light, dark or system, and nothing else.
// Selected segment takes the accent fill."
//
// Three real submit buttons in one form rather than a radio group and a save
// button: the choice is the action, and a person changing their theme should
// not have to confirm it. The shell re-renders with the new value and
// `AppearanceLive` writes `data-theme` from it, so the control's own state is never the source of
// truth — the document is.

const OPTIONS: { value: Theme; label: string; about: string }[] = [
  { value: 'light', label: 'Light', about: 'Always the light theme' },
  { value: 'dark', label: 'Dark', about: 'Always the dark theme' },
  {
    value: 'system',
    label: 'System',
    about: 'Follow this device’s own setting',
  },
]

export function ThemeForm({
  memberId,
  current,
}: {
  memberId: string
  current: Theme
}) {
  const [state, formAction, pending] = useActionState(setOwnTheme, null)

  return (
    <form action={formAction} className="flex flex-col items-end">
      <input type="hidden" name="memberId" value={memberId} />

      {/* Direction A's segmented pill (ticket 113), the chosen segment filled
          with the text colour. `group` rather than separate controls: they
          are one choice, and a screen reader should hear them that way. */}
      <fieldset disabled={pending}>
        <div
          role="group"
          aria-label="Light or dark"
          className="border-rule inline-flex rounded-full border p-0.5 text-caption"
        >
          {OPTIONS.map((option) => {
            const selected = option.value === current
            return (
              <button
                key={option.value}
                type="submit"
                name="theme"
                value={option.value}
                aria-pressed={selected}
                title={option.about}
                className={`rounded-full px-2.5 py-1 ${
                  selected ? 'bg-text text-ground' : 'text-text-muted'
                }`}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </fieldset>

      {/* Only a refusal is said; a saved theme is its own confirmation. */}
      <div aria-live="polite">
        {state && 'error' in state ? (
          <p className="text-bad-text mt-1 text-caption">{state.error}</p>
        ) : null}
        {state && 'saved' in state ? (
          <p className="sr-only">{state.saved}</p>
        ) : null}
      </div>
    </form>
  )
}
