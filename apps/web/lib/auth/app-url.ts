/**
 * The origin this deployment answers on, from `NEXT_PUBLIC_APP_URL`.
 *
 * Never derived from request headers. A forwarded `Host` is
 * attacker-controllable, and every URL built from this is a credential: a
 * sign-in redirect and a magic link both hand a session to whoever the URL
 * points at. `docs/configuration.md` says the same thing about invite links.
 */
export const appUrl = () => {
  const url = process.env.NEXT_PUBLIC_APP_URL
  if (!url) throw new Error('NEXT_PUBLIC_APP_URL is not set')
  return url.replace(/\/+$/, '')
}
