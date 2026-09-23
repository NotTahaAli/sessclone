// The viewer's few icons, inline so no icon package ships for them. 16px
// strokes in currentColor, so they take the text colour and both themes.

import type { ReactNode } from 'react'

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  )
}

export const CopyIcon = () => (
  <Icon>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </Icon>
)

export const CheckIcon = () => (
  <Icon>
    <path d="M20 6 9 17l-5-5" />
  </Icon>
)

export const InfoIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </Icon>
)

export const CodeIcon = () => (
  <Icon>
    <path d="m8 7-5 5 5 5M16 7l5 5-5 5" />
  </Icon>
)

export const ReloadIcon = () => (
  <Icon>
    <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
    <path d="M21 3v5h-5" />
  </Icon>
)

export const BackIcon = () => (
  <Icon>
    <path d="m15 18-6-6 6-6" />
  </Icon>
)

export const ChevronDownIcon = () => (
  <Icon>
    <path d="m6 9 6 6 6-6" />
  </Icon>
)

export const CloseIcon = () => (
  <Icon>
    <path d="M18 6 6 18M6 6l12 12" />
  </Icon>
)

export const FilterIcon = () => (
  <Icon>
    <path d="M4 6h16M7 12h10M10 18h4" />
  </Icon>
)
