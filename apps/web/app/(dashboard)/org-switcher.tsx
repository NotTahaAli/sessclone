'use client'

import {
  useCallback,
  useId,
  useRef,
  useState,
  type ReactNode,
  type ToggleEvent,
} from 'react'

import { ChevronDown } from '../_ui/primitives'
import { liveInvites, SwitcherBody } from './org-choices'
import type { OrgSwitcherData } from '../../lib/viewer'

// The Org switcher (variant A, Taha's pick): the brand line's Org name is the
// control.
// One native popover serves both widths — anchored under the name on desktop,
// a bottom sheet on a phone — so the browser owns the top layer, Escape and
// click-away, and there is no listener of ours to clean up (as `PillMenu`).
// ponytail: not re-placed on a resize while open; close and reopen fixes it.
// Before hydration (or without JavaScript) the popover still opens natively;
// the fallbacks in the class are where the sidebar's name always sits.

export function OrgSwitcher({
  data,
  current,
  orgName,
  className,
  children,
}: {
  data: OrgSwitcherData
  /** The viewer's current membership. */
  current: string
  orgName: string
  className: string
  /** The Org name as the brand line draws it (logo and truncation). */
  children: ReactNode
}) {
  const id = useId()
  const anchor = useRef<HTMLButtonElement>(null)
  const [place, setPlace] = useState<Record<`--${string}`, string>>({})

  const onToggle = useCallback((event: ToggleEvent<HTMLDivElement>) => {
    const box = anchor.current?.getBoundingClientRect()
    if (event.newState === 'open' && box) {
      setPlace({
        '--top': `${box.bottom + 6}px`,
        '--left': `${Math.max(8, box.left - 8)}px`,
      })
    }
  }, [])

  const live = liveInvites(data)

  return (
    <>
      <button
        ref={anchor}
        type="button"
        popoverTarget={id}
        aria-label={`${orgName}: switch Org${live ? `, ${live} pending invites` : ''}`}
        className={`${className} hover:text-text -mx-1 flex min-w-0 cursor-pointer items-center gap-1.5 rounded-sm px-1 uppercase`}
      >
        {children}
        {live ? (
          <span className="text-accent-text font-mono tracking-normal">
            {live}
          </span>
        ) : null}
        <ChevronDown />
      </button>
      <div
        id={id}
        popover="auto"
        onBeforeToggle={onToggle}
        role="dialog"
        aria-label="Orgs and invites"
        style={place}
        // Phone: a sheet along the bottom edge, over the scrim. Desktop: a
        // panel under the name, the scrim transparent.
        className="border-rule bg-ground text-text shadow-overlay backdrop:bg-overlay-scrim fixed inset-x-0 top-auto bottom-0 m-0 max-h-[80dvh] w-full max-w-none overflow-y-auto rounded-t-lg border-t p-1.5 pb-[calc(0.5rem+env(safe-area-inset-bottom))] text-left tracking-normal normal-case lg:right-auto lg:bottom-auto lg:top-[var(--top,42px)] lg:left-[var(--left,14px)] lg:max-h-[min(70vh,520px)] lg:w-72 lg:rounded-lg lg:border lg:pb-1.5 lg:backdrop:bg-transparent"
      >
        <div
          aria-hidden="true"
          className="bg-rule-strong mx-auto mt-1 mb-2 h-1 w-9 rounded-full lg:hidden"
        />
        <SwitcherBody data={data} current={current} orgName={orgName} />
      </div>
    </>
  )
}
