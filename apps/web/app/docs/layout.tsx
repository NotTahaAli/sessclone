import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import { RootProvider } from 'fumadocs-ui/provider/next'
import type { ReactNode } from 'react'

import { source } from '../../lib/docs'
import { Lockup } from '../_ui/logo'

// Scoped to `/docs`: the stylesheet is imported here and nowhere else, and
// its tokens only apply while this layout is on the page (`docs.css`).
// oxlint-disable-next-line no-unassigned-import
import './docs.css'

// Ticket 116. The provider lives here rather than in the root layout, so the
// rest of the product never loads Fumadocs. Its theme handling (next-themes)
// is off: the app's own contract is `data-theme` on `<html>` set by
// `AppearanceScript`, else the system preference, and `docs.css` follows the
// same two, so the docs match whatever the dashboard shows and offer no
// second switch that would disagree with it.
//
// Module scope, so each render passes the same objects.
const THEME = { enabled: false }
const NAV = { title: <Lockup size={18} />, url: '/' }

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RootProvider theme={THEME}>
      <DocsLayout tree={source.getPageTree()} nav={NAV} themeSwitch={THEME}>
        {children}
      </DocsLayout>
    </RootProvider>
  )
}
