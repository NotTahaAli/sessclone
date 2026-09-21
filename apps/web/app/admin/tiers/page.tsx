import { EmptyState } from '../../(dashboard)/empty-state'
import { PageHeader } from '../../(dashboard)/page-header'

// The destination ticket 62's navigation points at, so the shell is navigable
// rather than a menu of dead links. The surface itself is ticket 65's.

export default function Page() {
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="Tiers" />
      <EmptyState headline="Not built yet">
        Seats, price, capabilities and manual activation are tickets 65 and 48.
      </EmptyState>
    </div>
  )
}
