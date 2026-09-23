import { LegalButton } from './credit'
import { signOut } from '../sign-in/actions'
import type { Viewer } from '../../lib/viewer'

// The account block and Avatar, first needed at ticket 45.
//
// Until 2026-09-23 the account was a `<details>` menu behind the avatar. Taha
// asked for it to be always there instead: who you are, which Org and Role,
// and the way out, at the foot of the desktop sidebar and at the top of the
// phone's More page. Nothing to open means nothing to clip, and nothing a
// reader has to discover.

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

const SMALL_LINK = 'hover:text-accent-text cursor-pointer underline'

/**
 * Who is signed in: the name, the address (muted, truncated, whole in the
 * tooltip), the Org and Role as plain text, then Sign out and Legal.
 *
 * Sign out is a form posting to a Server Action, so it works before or
 * without JavaScript; Legal opens the notices popover, which needs none.
 */
export function AccountBlock({ viewer }: { viewer: Viewer }) {
  const name = viewer.displayName ?? viewer.email
  return (
    <div className="flex flex-col gap-0.5 text-caption">
      <p className="text-text flex items-center gap-2 text-body">
        <Avatar name={name} />
        <span className="truncate">{name}</span>
      </p>
      {viewer.displayName ? (
        <p className="text-text-muted truncate" title={viewer.email}>
          {viewer.email}
        </p>
      ) : null}
      <p className="text-text-muted truncate">
        {viewer.orgName} · {ROLE_LABEL[viewer.role]}
      </p>
      <div className="text-text-muted mt-1.5 flex items-center gap-3">
        <form action={signOut}>
          <button type="submit" className={SMALL_LINK}>
            Sign out
          </button>
        </form>
        <LegalButton />
      </div>
    </div>
  )
}
