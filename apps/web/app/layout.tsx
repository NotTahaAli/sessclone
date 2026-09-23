import { Geist, Geist_Mono } from 'next/font/google'
import type { ReactNode } from 'react'

import { AppearanceScript } from './appearance-script'

// A stylesheet has nothing to assign, and this import is how Next finds it.
// oxlint-disable-next-line no-unassigned-import
import './globals.css'

// Self-hosted, which is what the design system asks for: `next/font/google`
// downloads the files at build time and serves them from this origin, so no
// request leaves for fonts.googleapis.com at render and there is no
// layout-shifting swap from a third party. Each exposes a custom property,
// which is what `--font-sans` and `--font-mono` in `globals.css` point at.
//
// Nothing is loaded for the serif step: the design system serves the display
// face from system faces (Georgia and its fallbacks) and a webfont for one
// headline would be a download for a single line of text.
// Direction A (ticket 111): Geist and Geist Mono, both variable fonts, so no
// weight list is needed.
const sans = Geist({
  subsets: ['latin'],
  variable: '--font-geist',
  display: 'swap',
})

const mono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
})

export const metadata = {
  title: 'sessclone',
  description: 'Claude Code usage and cost, for a whole team.',
}

// No `data-theme` attribute rendered here, in either direction. A signed-out
// visitor has no stored preference, so the media query in `globals.css`
// decides and nothing has to run before first paint. A signed-in Member's
// preference is applied by `AppearanceScript` while the document is parsed
// (ticket 77) — rendering it from the session instead would make this layout,
// and therefore every route in the product, dynamic.
//
// `suppressHydrationWarning` on `<html>` is required by that: the script
// changes the element's attribute and inline style before React hydrates, and
// without it React treats the difference as an error and rebuilds from the
// payload, which throws the correction away.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <AppearanceScript />
      </head>
      <body>{children}</body>
    </html>
  )
}
