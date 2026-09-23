// The sessclone mark, R1 "Sigma prompt" (ticket 111): the prompt chevron
// closed into a sum sign, its bottom stroke in the accent. The body takes
// `currentColor`, so it follows the text it sits in and both themes; the
// accent stroke is the Org's derived fill, so a recoloured Org gets a
// recoloured mark. `app/icon.svg` is the same two paths with the Clay default
// written in, since a favicon cannot read the page's properties.

export function LogoMark({
  size = 16,
  className,
}: {
  size?: number
  className?: string
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className ?? ''}`}
    >
      <path
        d="M18 4.5H6l6.5 7.5L6 19.5"
        stroke="currentColor"
        strokeWidth={2.2}
      />
      <path
        d="M11 19.5h7"
        stroke="var(--color-accent-fill)"
        strokeWidth={2.4}
      />
    </svg>
  )
}

/** Mark and wordmark: the marketing nav, sign-in, the admin frame. */
export function Lockup({ size = 20 }: { size?: number }) {
  return (
    <span className="text-text inline-flex items-center gap-2 font-semibold tracking-[-0.02em]">
      <LogoMark size={size} />
      sessclone
    </span>
  )
}
