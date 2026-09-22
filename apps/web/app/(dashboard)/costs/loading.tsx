import { PageHeader } from '../page-header'
import { Skeleton } from '../skeleton'

// Costs' own fallback, which is the one the wireframes draw: the frame stays,
// and the chart and the ranked list are blocks at their final height so
// nothing moves when the rows land.
//
// It lives here rather than at the shell's root because a fallback names a
// page, and the root one was rendering this page's title over every other
// route under the shell — a click on Your settings showed "Costs" and a chart
// skeleton for as long as the read took.

export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Costs" />
      <Skeleton className="h-80" label="Loading the chart" />
      <Skeleton className="h-60" label={null} />
    </div>
  )
}
