import Link from 'next/link'

import { signOut } from '../sign-in/actions'
import { LogoMark } from '../_ui/logo'
import { Button, buttonClass } from '../_ui/primitives'

/**
 * What a locked Org sees instead of the dashboard (ticket 119): one sentence
 * and Sign out. Nothing else — no keys, no pages.
 *
 * It covers the frame rather than replacing it, because the frame is the
 * prerendered shell (ticket 83) and cannot know whose Org this is. The
 * navigation under it would lead nowhere else anyway: every route under this
 * layout renders this same page for a locked Org.
 */
export function Waiting({
  cancelled,
  orgName,
  operator,
}: {
  cancelled: boolean
  orgName: string
  /** A platform admin whose own Org is locked — the first sign-in on a fresh
   * deployment — gets the way to approve it. */
  operator: boolean
}) {
  return (
    <div className="bg-ground text-text fixed inset-0 z-50 overflow-y-auto">
      <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-16">
        <LogoMark size={28} className="text-text" />
        <h1 className="text-heading-lg">
          {cancelled ? 'Cancelled' : 'Waiting for approval'}
        </h1>
        <p className="text-text-muted text-body">
          {cancelled
            ? `${orgName}'s subscription has been cancelled. Nothing is collected while it is. Whoever operates this deployment can turn it back on.`
            : `${orgName} is waiting for whoever operates this deployment to approve it. Until then there is nothing to set up and nothing is collected. Reload this page once you hear it is approved.`}
        </p>
        <div className="flex flex-wrap gap-2">
          {operator ? (
            <Link href="/admin/orgs" className={buttonClass('primary')}>
              Open the Admin panel to approve it
            </Link>
          ) : null}
          <form action={signOut}>
            <Button type="submit">Sign out</Button>
          </form>
        </div>
      </main>
    </div>
  )
}
