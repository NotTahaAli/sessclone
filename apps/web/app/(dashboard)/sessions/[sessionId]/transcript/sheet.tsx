'use client'

import {
  useCallback,
  useEffect,
  useRef,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'

// A popup that never sits in the chat's flow (Taha, 2026-09-23): a sheet
// rising from the bottom on a phone, a centred card on a desktop. A native
// modal <dialog>, so focus, Escape and the inert page behind it come from the
// browser rather than from code here.

export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (open && !element.open) element.showModal()
    if (!open && element.open) element.close()
  }, [open])
  // A click on the backdrop lands on the dialog itself, outside its box.
  const onClick = useCallback(
    (event: MouseEvent<HTMLDialogElement>) => {
      if (event.target === event.currentTarget) onClose()
    },
    [onClose],
  )
  return (
    <dialog
      ref={dialog}
      aria-label={title}
      onClose={onClose}
      onClick={onClick}
      className="bg-ground text-text border-rule backdrop:bg-overlay-scrim fixed inset-x-0 top-auto bottom-0 m-0 max-h-[85dvh] w-full max-w-none overflow-y-auto rounded-t-2xl border p-0 lg:inset-0 lg:m-auto lg:max-h-[80dvh] lg:w-[28rem] lg:rounded-xl"
    >
      {open ? (
        <div className="flex flex-col gap-3 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-heading">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="text-text-muted hover:bg-surface-hover hover:text-text grid size-8 place-items-center rounded-md"
            >
              ✕
            </button>
          </div>
          {children}
        </div>
      ) : null}
    </dialog>
  )
}

const HOLD_MS = 450
const SLOP_PX = 10

/**
 * Press and hold on a touch screen (Taha, 2026-09-23): calls `onHold` after
 * 450ms unless the finger moves or lifts first, and swallows the browser's own
 * long-press menu on the element so the two never both appear.
 */
export function useLongPress(onHold: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const from = useRef<{ x: number; y: number } | null>(null)
  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    from.current = null
  }, [])
  useEffect(() => cancel, [cancel])

  const onPointerDown = useCallback(
    (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return
      cancel()
      from.current = { x: event.clientX, y: event.clientY }
      timer.current = setTimeout(() => {
        timer.current = null
        onHold()
      }, HOLD_MS)
    },
    [cancel, onHold],
  )
  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      const start = from.current
      if (
        start &&
        Math.hypot(event.clientX - start.x, event.clientY - start.y) > SLOP_PX
      )
        cancel()
    },
    [cancel],
  )
  const onContextMenu = useCallback((event: MouseEvent) => {
    // Android raises the native menu as a contextmenu event on long press.
    const native = event.nativeEvent
    if ('pointerType' in native && native.pointerType === 'touch')
      event.preventDefault()
  }, [])
  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onContextMenu,
  }
}
