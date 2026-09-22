/**
 * The path to land on after signing in, or null when it cannot be trusted.
 *
 * Where a visitor came from arrives in a query string, is carried through the
 * provider, and is redirected to with a fresh session in hand — so anything
 * that a browser resolves to another origin is an open redirect that hands
 * somebody's session away.
 *
 * "Starts with a slash" is not that check. `//evil.example` is an absolute URL
 * to every browser, and `/\evil.example` is the same trick with a backslash.
 * One place, used by the sign-in forms, the callback and the invitation page
 * alike, because three copies of this is three chances to keep one of them.
 */
export const safeNext = (value: unknown): string | null =>
  typeof value === 'string' &&
  value.startsWith('/') &&
  !value.startsWith('//') &&
  !value.startsWith('/\\')
    ? value
    : null

/**
 * The invitation token a `next` path carries, or null (ticket 77).
 *
 * `safeNext` decides whether a path may be redirected to; it does not decide
 * whether the path is well-formed. `decodeURIComponent` throws on a malformed
 * escape, so `?next=/join/%` took the whole sign-in page down for a signed-out
 * visitor who followed a mangled link. The shape is checked rather than the
 * decode trusted: a token is 43 base64url characters, and anything else is
 * a link that was going to fail at `/join` anyway.
 */
export const invitationToken = (returnTo: string | null) => {
  if (!returnTo?.startsWith('/join/')) return null
  let token
  try {
    token = decodeURIComponent(returnTo.slice('/join/'.length))
  } catch {
    return null
  }
  return /^[\w-]{16,128}$/.test(token) ? token : null
}
