import {
  BadgeDollarSign,
  Building2,
  ChevronLeft,
  CircleDollarSign,
  Ellipsis,
  KeyRound,
  Laptop,
  Layers,
  ScrollText,
  Settings,
  ShieldCheck,
  SquareTerminal,
  type LucideIcon,
} from 'lucide-react'

import type { NavIcon } from './navigation'

// Named imports from the package root are one module per icon in the bundle:
// Next's `optimizePackageImports` lists `lucide-react` by default
// (node_modules/next/dist/docs/.../optimizePackageImports.md, checked
// 2026-09-23), and the package declares `sideEffects: false`.
const ICONS: Record<NavIcon, LucideIcon> = {
  costs: CircleDollarSign,
  sessions: SquareTerminal,
  transcripts: ScrollText,
  keys: KeyRound,
  devices: Laptop,
  settings: Settings,
  admin: ShieldCheck,
  more: Ellipsis,
  back: ChevronLeft,
  rates: BadgeDollarSign,
  tiers: Layers,
  orgs: Building2,
}

/** An entry's icon: 16px, a 1.5 stroke, and hidden from assistive tech,
 * because the label beside it already says what it is. */
export function NavGlyph({ icon }: { icon: NavIcon | undefined }) {
  if (!icon) return null
  const Icon = ICONS[icon]
  return (
    <Icon aria-hidden="true" size={16} strokeWidth={1.5} className="shrink-0" />
  )
}

/**
 * A group's heading: a section label, not a control. Small, muted, more room
 * above than below so it reads as the start of what follows, and a plain
 * paragraph, so it takes no focus and no hover (2026-09-23).
 */
export const GROUP_HEADING =
  'text-label text-text-muted mx-2 mt-6 mb-1 select-none uppercase [:first-child>&]:mt-2'
