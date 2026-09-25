import { siteFlags } from './site-flags'

// Ticket 137: the read-only live demo.
//
// Taha's decisions (2026-09-25): generated data only, never real usage; the
// visitor is one fixed demo user, Owner of one demo Org and a Member of a
// second, so every page including Settings is visible; and every save
// refuses with one sentence rather than being undone later.
//
// Off unless `ENABLE_DEMO=true` (ticket 138's flags): a self-hosted copy has
// no demo, no /demo route and no "Try the demo" button unless its operator
// opts in. Read per call so a test can flip it.

/** Whether this deployment runs the demo. */
export const demoEnabled = () => siteFlags().demo

/**
 * The demo visitor's `users.id`. Fixed rather than looked up, so `asViewer`
 * can recognise it without a query. It never signs in through Supabase Auth
 * and `users.id` has no foreign key to `auth.users`, so no auth row exists;
 * Supabase draws random v4 ids, which never have this all-zero prefix.
 */
export const DEMO_USER_ID = '00000000-0000-4000-8000-00000000de30'

/** `.invalid` (RFC 2606): no mailbox can exist, so nobody can sign in as it. */
export const DEMO_EMAIL = 'visitor@demo.invalid'

export const isDemoUser = (userId: string | null | undefined) =>
  userId === DEMO_USER_ID

/**
 * The cookie `/demo` sets. It carries no identity and grants nothing a
 * visitor could not get by clicking the button, so it is not signed: it only
 * says "show me the demo" and is honoured only with no Supabase session.
 */
export const DEMO_COOKIE = 'sessclone-demo'

export const DEMO_COOKIE_OPTIONS = {
  path: '/',
  // A day: long enough to look around, short enough not to outlive interest.
  maxAge: 86_400,
  sameSite: 'lax',
  httpOnly: true,
  secure: (process.env.NEXT_PUBLIC_APP_URL ?? '').startsWith('https://'),
} as const

/** What every refused save says. */
export const DEMO_REFUSAL = 'This is a demo, so nothing you change is saved.'

/** The digest the dashboard's error boundary recognises. Next keeps an
 * error's own `digest` when it crosses to the browser, where the message is
 * redacted in production. */
export const DEMO_DIGEST = 'sessclone-demo-read-only'

/**
 * Thrown by `asViewer` when the database refused a demo write (SQLSTATE
 * 25006, read-only transaction). An action with an error channel returns
 * `DEMO_REFUSAL` before it gets that far; this is the backstop for the rest,
 * which the error boundary turns into the same sentence.
 */
export class DemoRefusal extends Error {
  readonly digest = DEMO_DIGEST
  constructor() {
    super(DEMO_REFUSAL)
    this.name = 'DemoRefusal'
  }
}

/** Postgres' `read_only_sql_transaction`. */
export const READ_ONLY_TRANSACTION = '25006'

/** The tag on the demo's cached page reads (`lib/page-reads.ts`), which the
 * refresh expires once it has changed the data. */
export const DEMO_CACHE_TAG = 'demo'
