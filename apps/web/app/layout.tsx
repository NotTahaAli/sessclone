import { Instrument_Sans, JetBrains_Mono } from 'next/font/google'
import type { ReactNode } from 'react'

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
const sans = Instrument_Sans({
  subsets: ['latin'],
  variable: '--font-instrument-sans',
  display: 'swap',
})

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
})

export const metadata = {
  title: 'sessclone',
  description: 'Claude Code usage and cost, for a whole team.',
}

// No `data-theme` attribute here. A signed-out visitor has no stored
// preference, so the media query in `globals.css` decides and nothing has to
// run before first paint; ticket 77 writes the attribute and the resolved
// accent for a signed-in Member.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  )
}
