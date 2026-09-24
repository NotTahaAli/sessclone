// What a failed round trip left in the query string, shared by `/sign-in` and
// `/sign-up`: both post to the same actions, and `returnPath` sends each
// visitor back to the page they came from with the notice attached.

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

// Matched, never rendered as it arrives — see `app/auth/callback/route.ts`.
const PROVIDER_CODE = /^[a-z_]{1,64}$/

export type NoticeQuery = Promise<{
  error?: string
  sent?: string
  code?: string
}>

/** The error or the "link sent" confirmation, if the query carries one.
 * `sentMessage` is the page's own wording for a sent link. */
export async function Notices({
  searchParams,
  sentMessage,
}: {
  searchParams: NoticeQuery
  sentMessage: string
}) {
  const { error, sent, code } = await searchParams

  return (
    <>
      {error === 'provider' ? (
        <p
          role="alert"
          className="border-bad-border bg-bad-bg text-bad-text mt-4 rounded-md border px-3 py-2 text-caption"
        >
          The provider refused the sign-in (
          {code && PROVIDER_CODE.test(code) ? code : 'unknown'}). Nothing is
          wrong with your account. Check the provider&apos;s settings in
          Supabase, or use a link instead.
        </p>
      ) : error ? (
        <p
          role="alert"
          className="border-bad-border bg-bad-bg text-bad-text mt-4 rounded-md border px-3 py-2 text-caption"
        >
          {MESSAGES[error] ?? 'Something went wrong.'}
        </p>
      ) : null}

      {sent ? (
        <p
          role="status"
          className="border-ok-border bg-ok-bg text-ok-text mt-4 rounded-md border px-3 py-2 text-caption"
        >
          {sentMessage}
        </p>
      ) : null}
    </>
  )
}
