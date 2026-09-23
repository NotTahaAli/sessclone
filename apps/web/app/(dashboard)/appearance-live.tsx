'use client'

import { useEffect } from 'react'

import { applyAppearance } from '../apply-appearance'

/**
 * Repaints the document when the appearance the server read changes under a
 * page that is already open — a saved accent or theme, whose Server Action
 * re-renders the shell without a full load. `apply-appearance.ts` says why an
 * inline script cannot do this part.
 */
export function AppearanceLive({ value }: { value: string }) {
  useEffect(() => applyAppearance(value, document.documentElement), [value])
  return null
}
