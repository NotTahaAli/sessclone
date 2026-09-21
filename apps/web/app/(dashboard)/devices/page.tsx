import { EmptyState } from '../empty-state'
import { PageHeader } from '../page-header'

// Devices is ticket 57: a Member's own machines, their nicknames, and when each last reported. The destination exists from ticket 45 because the navigation is built once rather than accreted, and a nav entry that 404s is worse than one that says what is coming.

export default function Page() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Devices" />
      <EmptyState headline="Not built yet">
        Your machines and when each last reported will appear here. Until then,
        Costs tells you whether anything has arrived at all.
      </EmptyState>
    </div>
  )
}
