'use client'

import { usePathname } from 'next/navigation'

/** The address that was asked for, as the 404's log line prints it. */
export function RequestedPath() {
  return <>{usePathname()}</>
}
