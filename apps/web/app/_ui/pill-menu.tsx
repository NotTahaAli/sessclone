'use client'

import Link from 'next/link'
import {
  useCallback,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  type ToggleEvent,
} from 'react'

import { ChevronDown, pillClass } from './primitives'

// The header pill menu (ticket 111): the transcript viewer's `ViewMenu`
// pattern, made general. A native popover, so the browser gives the menu the
// top layer, Escape and click-away, and there is no listener of ours to clean
// up. The top layer ignores the pill's position, so the menu is placed under
// the pill, right edges aligned, as it opens.
// ponytail: not re-placed on a resize while open; close and reopen fixes it.

export function PillMenu({
  label,
  detail,
  menuLabel,
  children,
}: {
  label: ReactNode
  /** Muted text after a middle dot, such as a date range. */
  detail?: ReactNode
  /** The menu's accessible name. */
  menuLabel: string
  /** `MenuItem`s, `MenuHeading`s and `MenuDivider`s. */
  children: ReactNode
}) {
  const id = useId()
  const pill = useRef<HTMLButtonElement>(null)
  const [place, setPlace] = useState<CSSProperties>({})

  const onToggle = useCallback((event: ToggleEvent<HTMLDivElement>) => {
    const box = pill.current?.getBoundingClientRect()
    if (event.newState === 'open' && box) {
      setPlace({
        top: box.bottom + 6,
        right: Math.max(8, document.documentElement.clientWidth - box.right),
      })
    }
  }, [])

  return (
    <>
      <button ref={pill} type="button" popoverTarget={id} className={pillClass}>
        <span className="truncate">{label}</span>
        {detail ? (
          <span className="text-text-muted truncate text-caption">
            · {detail}
          </span>
        ) : null}
        <ChevronDown />
      </button>
      <div
        id={id}
        popover="auto"
        onBeforeToggle={onToggle}
        role="menu"
        aria-label={menuLabel}
        style={place}
        className="border-rule bg-ground text-text shadow-overlay fixed inset-auto m-0 w-64 max-w-[calc(100vw-16px)] rounded-lg border p-1"
      >
        {children}
      </div>
    </>
  )
}

/** Closes the popover an item sits in: picking is the end of a menu. */
const closeMenu = (event: MouseEvent<HTMLElement>) =>
  event.currentTarget.closest<HTMLElement>('[popover]')?.hidePopover()

const ITEM =
  'hover:bg-surface-hover flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]'

/** One choice: a link with `href`, else a button calling `onSelect`. `on`
 * shows the tick beside the current choice. */
export function MenuItem({
  on,
  href,
  onSelect,
  children,
}: {
  on?: boolean
  href?: string
  onSelect?: () => void
  children: ReactNode
}) {
  const tick = (
    <span aria-hidden="true" className="w-3 shrink-0 text-center">
      {on ? '✓' : ''}
    </span>
  )
  const onClick = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      onSelect?.()
      closeMenu(event)
    },
    [onSelect],
  )
  return href ? (
    <Link
      href={href}
      role="menuitemradio"
      aria-checked={on ?? false}
      onClick={closeMenu}
      className={ITEM}
    >
      {tick}
      {children}
    </Link>
  ) : (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={on ?? false}
      onClick={onClick}
      className={ITEM}
    >
      {tick}
      {children}
    </button>
  )
}

export const MenuHeading = ({ children }: { children: ReactNode }) => (
  <p className="text-text-muted px-2 pt-1.5 pb-1 text-label uppercase">
    {children}
  </p>
)

export const MenuDivider = () => <hr className="border-rule my-1" />
