'use client'

import {
  Children,
  useCallback,
  useId,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'

// Two tabs over the install steps, "Your machine" and "Cloud environment"
// (ticket 95, Taha's pick). A client module for the one piece of state, which
// tab is showing; both panels are rendered by the server and passed in as
// children, so the commands are in the markup either way. Arrow keys move
// between the tabs, as the WAI-ARIA tabs pattern expects.

const TABS = ['Your machine', 'Cloud environment'] as const

export function SetupTabs({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(0)
  const id = useId()
  const panels = Children.toArray(children)

  const choose = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    setActive(Number(event.currentTarget.dataset.index))
  }, [])

  const arrow = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const last = TABS.length - 1
      const next =
        event.key === 'ArrowRight'
          ? (active + 1) % TABS.length
          : event.key === 'ArrowLeft'
            ? (active + last) % TABS.length
            : event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? last
                : null
      if (next === null) return
      event.preventDefault()
      setActive(next)
      document.getElementById(`${id}-tab-${next}`)?.focus()
    },
    [active, id],
  )

  return (
    <div className="mt-6 max-w-3xl">
      <div
        role="tablist"
        aria-label="Where to install"
        className="border-rule flex gap-4 border-b"
        onKeyDown={arrow}
      >
        {TABS.map((label, index) => (
          <button
            key={label}
            id={`${id}-tab-${index}`}
            type="button"
            role="tab"
            data-index={index}
            aria-selected={active === index}
            aria-controls={`${id}-panel-${index}`}
            tabIndex={active === index ? 0 : -1}
            onClick={choose}
            className={`text-body -mb-px border-b-2 py-2 ${
              active === index
                ? 'border-accent-border text-text'
                : 'text-text-secondary border-transparent'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {panels.map((panel, index) => (
        <div
          key={TABS[index]}
          id={`${id}-panel-${index}`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-${index}`}
          hidden={active !== index}
        >
          {panel}
        </div>
      ))}
    </div>
  )
}
