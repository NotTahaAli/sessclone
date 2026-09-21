import { EmptyState } from '../../empty-state'
import { PageHeader } from '../../page-header'

// Your settings is tickets 77 (appearance), 72 (archival), 57 (your Devices), 60 and 73 (your Log Artifacts) and 46 (your Scope). Ticket 45 opens the destination so the navigation is complete; each of those tickets fills in its own section.

export default function Page() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Your settings" />
      <EmptyState headline="Not built yet">
        Your appearance, your archival switch, your Devices and your Log
        Artifacts will live here.
      </EmptyState>
    </div>
  )
}
