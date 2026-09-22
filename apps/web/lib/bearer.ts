import { createHash, timingSafeEqual } from 'node:crypto'

// One reading of `Authorization: Bearer …`, and one comparison of a shared
// secret, for the routes whose caller is a program rather than a person: the
// pricing revalidation (ticket 80) and the retention sweep (ticket 61). They
// had a copy each, so a fix to either — a header with no value, a second
// `Authorization` header — reached neither.

/** The bearer token, or `''`. The scheme is case-insensitive per RFC 9110. */
export const presentedBearer = (request: Request) => {
  const header = request.headers.get('authorization')
  const [scheme, ...rest] = header?.trim().split(/\s+/) ?? []
  return scheme?.toLowerCase() === 'bearer' ? rest.join(' ') : ''
}

/**
 * Whether the presented secret is the expected one, in constant time.
 *
 * Both sides are hashed first, which is what makes the comparison
 * length-independent as well as constant time: `timingSafeEqual` throws on
 * buffers of different lengths, and refusing early on a length mismatch would
 * leak the secret's length one guess at a time.
 */
export const secretMatches = (presented: string, expected: string) =>
  timingSafeEqual(digest(presented), digest(expected))

const digest = (value: string) => createHash('sha256').update(value).digest()
