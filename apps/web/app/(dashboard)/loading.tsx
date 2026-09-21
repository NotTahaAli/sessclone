import { PageHeader } from './page-header'
import { Skeleton } from './skeleton'

// What every page under the shell shows while its data is in flight. The
// shell itself — the navigation, the Org name, the account menu — is already
// on the screen: this file replaces only the content column, which is what
// makes the frame render immediately and stay put.

export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Costs" />
      {/* The two blocks the wireframes draw, at the heights the chart and the
          ranked list occupy, so nothing moves when the rows land. */}
      <Skeleton className="h-80" label="Loading the chart" />
      <Skeleton className="h-60" label="Loading the list" />
    </div>
  )
}
