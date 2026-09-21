import { EmptyState } from '../../empty-state'
import { PageHeader } from '../../page-header'

// Org settings is tickets 51 (timezone), 61 (retention), 77 (appearance defaults and the logo) and 49 and 50 (Members, Roles and invitations). Reachable by an Owner or an Admin, which is settled in the product IA and wider than tickets 49, 50 and 61 each say on their own. The Tier page is Owner-only and is ticket 47's; it is not linked from here.

export default function Page() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Org settings" />
      <EmptyState headline="Not built yet">
        Timezone, retention, appearance defaults, Members and invitations will
        live here.
      </EmptyState>
    </div>
  )
}
