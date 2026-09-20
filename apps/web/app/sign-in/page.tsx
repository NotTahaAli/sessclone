import { sendMagicLink, signInWithGitHub } from './actions'

// Deliberately unstyled. The design system (ticket 16) is documented and not
// yet built — there is no Tailwind, no `globals.css` and no shell in this app
// — and ticket 45 is where the shell and these tokens land. Markup first, so
// that ticket dresses a page that already works rather than one that has to be
// rewritten to.

const MESSAGES: Record<string, string> = {
  github: 'GitHub sign-in could not be started. Try again, or use a link.',
  email: 'That does not look like an email address.',
  link: 'The link could not be sent. Try again in a moment.',
  exchange: 'That sign-in could not be completed. Start again.',
  callback: 'That link is missing something. Start again.',
  session: 'Signed in, but the session did not stick. Start again.',
  identity:
    'That email address already belongs to an account signed in a different way. Use the way you signed in the first time.',
  bootstrap: 'Signed in, but your organisation could not be set up. Try again.',
}

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string }>
}) {
  const { error, sent } = await searchParams

  return (
    <main>
      <h1>Sign in to sessclone</h1>

      {error ? (
        <p role="alert">{MESSAGES[error] ?? 'Something went wrong.'}</p>
      ) : null}

      {sent ? (
        <p role="status">
          If that address has an account, a sign-in link is on its way. The link
          works once and expires.
        </p>
      ) : null}

      <form action={signInWithGitHub}>
        <button type="submit">Continue with GitHub</button>
      </form>

      <form action={sendMagicLink}>
        <label htmlFor="email">Or get a sign-in link by email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
        />
        <button type="submit">Email me a link</button>
      </form>

      <p>
        There is no password to set or forget. Signing in for the first time
        creates an organisation with you as its owner.
      </p>
    </main>
  )
}
