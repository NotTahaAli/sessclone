import { EmptyState } from '../../(dashboard)/empty-state'
import { PageHeader } from '../../(dashboard)/page-header'

// The destination ticket 62's navigation points at, so the shell is navigable
// rather than a menu of dead links. The surface itself is ticket 65's.

export default function Page() {
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="Orgs" />
      <EmptyState headline="Not built yet">
        Every Org&apos;s Tier and subscription history is ticket 65.
      </EmptyState>
    </div>
  )
}
