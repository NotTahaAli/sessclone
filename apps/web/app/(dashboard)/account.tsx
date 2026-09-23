import { signOut } from '../sign-in/actions'
import type { Viewer } from '../../lib/viewer'
import { buttonClass } from '../_ui/primitives'

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
  name,
  size = 24,
}: {
  /** The display name when there is one, else the address: its first letter. */
  name: string
  size?: keyof typeof AVATAR
}) {
  return (
    <span
      aria-hidden="true"
      className={`bg-surface-hover text-text-muted inline-flex shrink-0 items-center justify-center rounded-full text-caption uppercase ${AVATAR[size]}`}
    >
      {name.slice(0, 1)}
    </span>
  )
}

export function AccountMenu({ viewer }: { viewer: Viewer }) {
  return (
    <details className="group relative">
      <summary className="hover:bg-surface-hover flex h-[var(--control-h)] cursor-pointer list-none items-center gap-2 rounded-md px-2 text-caption lg:text-[13px]">
        <Avatar name={viewer.displayName ?? viewer.email} />
        {/* Only the avatar shows on a phone (Direction A); the name stays
            for a screen reader, since the avatar is hidden from one. */}
        <span className="text-text-muted truncate max-lg:sr-only">
          {viewer.displayName ?? viewer.email}
        </span>
      </summary>

      {/* The panel opens away from the edge the summary sits against, and
          that edge is different at the two widths (`(dashboard)/layout.tsx`).

          On a phone the summary is in the header at the top of the window, so
          the panel drops below it and is hung from its right edge, the header
          putting the summary against the right of the window.

          From `lg` up the summary is at the foot of the 232px sidebar, so the
          panel rises above it — dropping it below would put it under the
          bottom of the window — and is hung from its left edge: a panel wider
          than the sidebar hung from the right runs off the left of the
          window, which is what this looked like. Hung from the left it
          overhangs into the content column instead, which is what an overlay
          is for. The width is capped at the window either way, for the
          narrowest phone. */}
      <div className="bg-ground border-rule shadow-overlay absolute top-full right-0 z-10 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-lg border p-3 lg:top-auto lg:right-auto lg:bottom-full lg:left-0 lg:mt-0 lg:mb-1">
        {/* Ticket 100: the name leads, and the address stays under it so
            the person can see which account they are signed in as. */}
        <p className="text-text truncate text-body">
          {viewer.displayName ?? viewer.email}
        </p>
        {viewer.displayName ? (
          <p className="text-text-muted truncate text-caption">
            {viewer.email}
          </p>
        ) : null}
        <p className="text-text-muted mt-1 truncate text-caption">
          {viewer.orgName}
          {' · '}
          {/* The Role badge. A Role is an authority, not a status, so it takes
              the neutral tokens rather than a status colour. */}
          <span className="border-rule text-text-muted rounded-full border px-2 py-0.5 text-caption">
            {ROLE_LABEL[viewer.role]}
          </span>
        </p>

        <form action={signOut} className="mt-3">
          <button type="submit" className={`${buttonClass()} w-full`}>
            Sign out
          </button>
        </form>
      </div>
    </details>
  )
}
