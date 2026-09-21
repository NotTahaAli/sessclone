import { signOut } from '../sign-in/actions'
import type { Viewer } from '../../lib/viewer'

// AccountMenu and Avatar from the design system's inventory, both first needed
// at ticket 45.
//
// `<details>` rather than a click handler and a piece of state: the browser
// already opens and closes a disclosure, closes it on Escape, and puts it in
// the tab order. A React version of that is a client module, a bundle, and a
// list of keyboard cases to get wrong. Ticket 77 adds the appearance link to
// this menu, which is still one more `<li>` and not a reason to rewrite it.

/** The Role, as the reader's own word for their authority. */
const ROLE_LABEL = {
  owner: 'Owner',
  admin: 'Admin',
  manager: 'Manager',
  member: 'Member',
} as const

/** The three sizes the design system defines, and no fourth. */
const AVATAR = {
  20: 'size-5',
  24: 'size-6',
  32: 'size-8',
} as const

export function Avatar({
  email,
  size = 24,
}: {
  email: string
  size?: keyof typeof AVATAR
}) {
  return (
    <span
      aria-hidden="true"
      className={`bg-quiet-bg text-text-secondary inline-flex shrink-0 items-center justify-center rounded-full text-label uppercase ${AVATAR[size]}`}
    >
      {email.slice(0, 1)}
    </span>
  )
}

export function AccountMenu({ viewer }: { viewer: Viewer }) {
  return (
    <details className="group relative">
      <summary className="hover:bg-surface-hover flex h-[var(--control-h)] cursor-pointer list-none items-center gap-2 rounded-md px-2 text-body">
        <Avatar email={viewer.email} />
        <span className="text-text-secondary truncate">{viewer.email}</span>
      </summary>

      {/* Right-aligned and above the bottom bar on a phone, which is where
          the summary sits on that width. */}
      <div className="bg-surface border-rule shadow-overlay absolute right-0 bottom-full z-10 mb-1 w-64 rounded-md border p-3 lg:top-full lg:bottom-auto lg:mt-1 lg:mb-0">
        <p className="text-text truncate text-body">{viewer.email}</p>
        <p className="text-text-muted mt-1 truncate text-caption">
          {viewer.orgName}
          {' · '}
          {/* The Role badge. A Role is an authority, not a status, so it takes
              the neutral tokens rather than a status colour. */}
          <span className="bg-quiet-bg text-quiet-text rounded-sm px-1.5 py-0.5 text-micro uppercase">
            {ROLE_LABEL[viewer.role]}
          </span>
        </p>

        <form action={signOut} className="mt-3">
          <button
            type="submit"
            className="border-control-border text-text hover:bg-surface-hover h-[var(--control-h)] w-full rounded-md border px-3 text-body"
          >
            Sign out
          </button>
        </form>
      </div>
    </details>
  )
}
