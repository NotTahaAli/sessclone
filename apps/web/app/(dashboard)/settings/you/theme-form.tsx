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
// not have to confirm it. The page reloads with the new `data-theme` written
// by the server-set cookie, so the control's own state is never the source of
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
    <form action={formAction} className="mt-4">
      <input type="hidden" name="memberId" value={memberId} />

      <fieldset disabled={pending}>
        <legend className="text-text-secondary text-sm">Light or dark</legend>
        {/* `group` rather than a list of separate controls: they are one
            choice, and a screen reader should hear them that way. */}
        <div
          role="group"
          aria-label="Light or dark"
          className="border-control-border mt-3 inline-flex overflow-hidden rounded border"
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
                className={`h-[var(--control-h)] border-l px-4 text-sm first:border-l-0 ${
                  selected
                    ? 'bg-accent-fill text-accent-on-fill border-accent-border'
                    : 'border-control-border text-text'
                }`}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </fieldset>

      <div aria-live="polite">
        {state && 'error' in state ? (
          <p className="text-bad-text mt-3 text-sm">{state.error}</p>
        ) : null}
        {state && 'saved' in state ? (
          <p className="text-ok-text mt-3 text-sm">{state.saved}</p>
        ) : null}
      </div>
    </form>
  )
}
