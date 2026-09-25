import { keepAccount } from './settings/you/deletion-actions'
import { signOut } from '../sign-in/actions'
import { Button } from '../_ui/primitives'

/**
 * What a person in their deletion grace sees instead of the dashboard
 * (ticket 141): when it happens, Keep my account, Sign out. It covers the
 * frame as the waiting page does, for the same reason (ticket 119).
 */
export function DeletionPending({ due }: { due: Date }) {
  const day = due.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
  return (
    <div className="bg-ground text-text fixed inset-0 z-50 overflow-y-auto">
      <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-16">
        <h1 className="text-heading-lg">Your account is being deleted</h1>
        <p className="text-text-muted text-body">
          It will be deleted on {day}. Until then nothing is recorded from your
          machines. Keep it, and everything comes back as it was.
        </p>
        <div className="flex flex-wrap gap-2">
          <form action={keepAccount}>
            <Button type="submit" variant="primary">
              Keep my account
            </Button>
          </form>
          <form action={signOut}>
            <Button type="submit">Sign out</Button>
          </form>
        </div>
      </main>
    </div>
  )
}
