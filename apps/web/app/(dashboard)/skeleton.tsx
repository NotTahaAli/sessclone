// Skeleton, from the design system's inventory: blocks matching the content.
//
// The wireframes are specific about what loading looks like, and it is not a
// spinner: "The frame, the tabs and the range control render immediately; the
// chart and the list render as blocks at their final height in the panel
// colour. No spinner, and no layout shift when the data lands."
//
// So the block takes its height from the caller rather than guessing one, and
// there is no shimmer at all. An animation here would have to be suppressed
// under `prefers-reduced-motion`; no animation is the same result with nothing
// to remember.

export function Skeleton({
  /** A height class, e.g. `h-80`. The caller knows what lands there. */
  className,
  label,
}: {
  className: string
  /**
   * What is loading here. `null` makes the block decorative, for the second
   * and later blocks of one fallback: a screen reader announcing "Loading"
   * once per block says nothing the first one did not.
   */
  label?: string | null
}) {
  return label === null ? (
    <div
      aria-hidden="true"
      className={`bg-surface border-rule rounded-md border ${className}`}
    />
  ) : (
    <div
      className={`bg-surface border-rule rounded-md border ${className}`}
      role="status"
      aria-label={label ?? 'Loading'}
    />
  )
}
