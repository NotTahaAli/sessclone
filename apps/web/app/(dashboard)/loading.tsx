import { Skeleton } from './skeleton'

// What every page under the shell shows while its data is in flight, except
// the ones with a fallback of their own. The shell — the navigation, the Org
// name, the account menu — is already on the screen: this replaces only the
// content column, which is what makes the frame render immediately and stay
// put.
//
// Deliberately without a title. A fallback that names a page has to name the
// right one, and this file is the fallback for every route that does not
// carry its own; the previous version said "Costs" everywhere. A block where
// the header will be is honest at any of them, and the header that lands is
// the same height.

export default function Loading() {
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Skeleton className="h-12" label="Loading" />
      <Skeleton className="h-64" label={null} />
    </div>
  )
}
