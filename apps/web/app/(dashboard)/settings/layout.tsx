import type { ReactNode } from 'react'

import { SettingsIndex } from './settings-index'
import { settingsIndex } from '../navigation'
import { PageHeader } from '../page-header'
import { currentViewer } from '../../../lib/viewer'

// Ticket 113: settings as the approved design draws them on desktop — the
// index in a column on the left and the open page on the right, so moving
// between You, Org and Members never leaves the list. On a phone the index is
// the Settings page and each page has a ‹ back to it.
//
// The viewer read is `currentViewer()`, which is `cache`d for the request, so
// this and the page under it share one read. Which entries appear is the
// Role's, as `settingsFor` has always decided; the pages still guard their own
// URLs, since hiding a link is not a check.

export default async function SettingsLayout({
  children,
}: {
  children: ReactNode
}) {
  const viewer = await currentViewer()
  if (!viewer) return children

  const items = settingsIndex(viewer.role)

  return (
    <div className="flex flex-col">
      <div className="hidden lg:block">
        <PageHeader title="Settings" />
      </div>
      <div className="lg:grid lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
        <SettingsIndex
          items={items}
          you={viewer.displayName ?? viewer.email}
          org={viewer.orgName}
        />
        <div className="min-w-0 lg:border-rule lg:min-h-[60vh] lg:border-l lg:pt-3 lg:pl-7">
          {children}
        </div>
      </div>
    </div>
  )
}
