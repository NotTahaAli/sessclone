import { EmptyState } from '../../(dashboard)/empty-state'
import { PageHeader } from '../../(dashboard)/page-header'

// The destination ticket 62's navigation points at, so the shell is navigable
// rather than a menu of dead links. The surface itself is ticket 63's.

export default function Page() {
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="Rates" />
      <EmptyState headline="Not built yet">
        The published price list and the unknown models are ticket 63; an
        Org&apos;s negotiated overrides are ticket 64.
      </EmptyState>
    </div>
  )
}
