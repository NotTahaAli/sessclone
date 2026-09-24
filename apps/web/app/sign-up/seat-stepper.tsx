'use client'

import { useCallback, useState, type ChangeEvent } from 'react'

const ROUND =
  'border-rule text-text hover:bg-surface-hover inline-flex size-7 cursor-pointer items-center justify-center rounded-full border text-[15px] leading-none disabled:cursor-not-allowed disabled:opacity-40'

/**
 * The Team size on the plan step: − and + around the number, which is still
 * a real `seats` input, so the form posts it and a keyboard can type it. The
 * bounds are the Team Tier's; `parsePlan` clamps again on the way in.
 */
export function SeatStepper({
  min,
  max,
  initial,
}: {
  min: number
  max: number | null
  initial: number
}) {
  const [seats, setSeats] = useState(initial)
  const clamp = useCallback(
    (n: number) => Math.min(Math.max(n, min), max ?? Infinity),
    [min, max],
  )
  const fewer = useCallback(() => setSeats((n) => clamp(n - 1)), [clamp])
  const more = useCallback(() => setSeats((n) => clamp(n + 1)), [clamp])
  const typed = useCallback(
    (event: ChangeEvent<HTMLInputElement>) =>
      setSeats(Number(event.target.value) || min),
    [min],
  )
  const settle = useCallback(() => setSeats(clamp), [clamp])

  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        aria-label="One fewer person"
        disabled={seats <= min}
        onClick={fewer}
        className={ROUND}
      >
        −
      </button>
      <input
        name="seats"
        type="number"
        inputMode="numeric"
        aria-label="Team size"
        min={min}
        max={max ?? undefined}
        value={seats}
        onChange={typed}
        onBlur={settle}
        className="text-text w-8 [appearance:textfield] bg-transparent text-center font-mono text-[14px] tabular-nums [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button
        type="button"
        aria-label="One more person"
        disabled={max !== null && seats >= max}
        onClick={more}
        className={ROUND}
      >
        +
      </button>
    </span>
  )
}
