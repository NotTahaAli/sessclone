import { revalidatePath } from 'next/cache'

/**
 * Every dashboard page that shows a price. A Rate or an override reprices
 * Turns on the next read (ADR 0002), so these, and only these, go stale when
 * one changes — not the marketing site, the docs or the rest of settings.
 * A new page that shows a cost belongs here.
 */
export const COST_PATHS = [
  ['/costs', 'layout'],
  ['/sessions', 'layout'],
  ['/turns', 'layout'],
  ['/devices', 'page'],
  ['/more', 'page'],
  ['/settings/you', 'page'],
  ['/settings/org/rates', 'page'],
] as const

/** Expires the pages above, after a rate changed. */
export const revalidateCostPages = () => {
  for (const [path, type] of COST_PATHS) revalidatePath(path, type)
}
