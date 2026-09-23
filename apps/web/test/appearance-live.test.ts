import { isValidElement, type ReactNode } from 'react'
import { expect, test, vi } from 'vitest'

import { encodeAppearance } from '../lib/appearance'

// The bug this pins: saving an accent took effect only after a full reload.
// The save writes the cookie and revalidates, so the shell re-renders from the
// RSC payload — where `AppearanceSync` found the cookie already current and
// rendered nothing, and where a `<script>` it rendered would not have run
// anyway. What the re-rendered shell must carry is the value, to a client
// component that applies it.

const appearance = vi.hoisted(() => ({
  theme: 'dark' as const,
  tones: {
    fill: '#123456',
    onFill: '#FFFFFF',
    border: '#123456',
    textLight: '#123456',
    textDark: '#ABCDEF',
    subtleLight: '#EEEEEE',
    subtleDark: '#111111',
  },
}))
const wanted = encodeAppearance(appearance)

vi.mock('../lib/viewer', () => ({
  currentViewer: async () => ({ userId: 'user' }),
}))
vi.mock('../lib/db', () => ({ asViewer: async () => appearance }))
// The action already wrote the new value into the cookie.
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () => ({ value: encodeAppearance(appearance) }),
  }),
}))

const values = (node: ReactNode): string[] => {
  if (!isValidElement<{ value?: unknown; children?: ReactNode }>(node)) {
    return Array.isArray(node) ? node.flatMap(values) : []
  }
  const own = typeof node.props.value === 'string' ? [node.props.value] : []
  return [...own, ...values(node.props.children)]
}

test('a saved accent repaints the open page, with no reload', async () => {
  const { AppearanceSync } = await import('../app/(dashboard)/appearance-sync')
  const { applyAppearance } = await import('../app/apply-appearance')

  const rendered = await AppearanceSync()
  expect(values(rendered)).toContain(wanted)

  // And that value, applied, is the new accent on the document.
  const style = new Map<string, string>()
  const attributes = new Map<string, string>()
  applyAppearance(wanted, {
    style: { setProperty: (name, value) => style.set(name, value) },
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name),
  })
  expect(style.get('--accent-fill')).toBe('#123456')
  expect(attributes.get('data-theme')).toBe('dark')
})
