import { notFound } from 'next/navigation'
import { EmptyState } from '../../empty-state'
import { PageHeader } from '../../page-header'
import { currentViewer, reachesOrgSettings } from '../../../../lib/viewer'

// Org settings is tickets 51 (timezone), 61 (retention), 77 (appearance defaults and the logo) and 49 and 50 (Members, Roles and invitations). Reachable by an Owner or an Admin, which is settled in the product IA and wider than tickets 49, 50 and 61 each say on their own. The Tier page is Owner-only and is ticket 47's; it is not linked from here.

// The nav hides this from a Manager and a Member, and hiding a link is not a
// check — the URL is typeable. ADR 0001 means the *data* is safe either way,
// because every read here will be policy-scoped, but the surface is not, and
// the guard is cheaper to write now than to remember when ticket 51 or 61 puts
// a control on this page.
export default async function Page() {
  const viewer = await currentViewer()
  if (!viewer || !reachesOrgSettings(viewer.role)) notFound()

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
