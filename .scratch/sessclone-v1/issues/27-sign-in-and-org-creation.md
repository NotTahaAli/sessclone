# 27: Sign-in and org creation

**What to build:** A person signs in with GitHub or a magic link, and on first sign-in an Org is created with them as its Owner.

**Blocked by:** 20, 21.

**Status:** done

- [x] GitHub sign-in works end to end
- [x] Magic-link sign-in works end to end, for people whose employer blocks OAuth apps
- [x] First sign-in creates an Org and makes the signer its Owner
- [x] Signing out and back in returns to the same Org
- [x] No password is ever created or stored

**Answer:** Supabase Auth owns sign-in; everything after it runs as the signer
through `apps/web/lib/db.ts`, which is ADR 0007's connection function and the
only way anything in this app obtains a connection.

- `app/sign-in/` — the page and its Server Functions. Two ways in and one way
  out, and neither way in involves a password: `signInWithOAuth` for GitHub and
  `signInWithOtp` for a link, since several employers block third-party OAuth
  apps outright and without the second route those teams cannot sign in at all.
  The link form answers the same way whether or not the address is known.
- `app/auth/callback/route.ts` — where both come back to, handling the OAuth
  PKCE `code` and the magic link's `token_hash` alike, because which one
  Supabase sends depends on the project's email template. `next` is honoured
  only when it is a path, so the callback cannot be turned into an open
  redirect that hands a fresh session to another origin.
- `lib/auth/bootstrap.ts` — `ensureOrgForSigner`, which runs on every sign-in
  rather than only the first. There is no reliable "first": GitHub and a link
  are two routes into one account, and an interrupted callback leaves a session
  with no Org. Idempotent by construction, so signing out and back in returns
  the same Org.
- `proxy.ts` — Next 16's name for middleware. Refreshes the session, which
  Server Components cannot do because they cannot write cookies, and redirects
  a signed-out visitor. Not the authorisation layer; that is RLS.
- `supabase/migrations/20260920120500_sign_in.sql` — `users_create_self`, which
  ticket 21 left out: `users` had no insert policy, so nothing could create the
  row for a first-time signer. Narrow on purpose — the id must equal the
  verified claim, and the row may not arrive holding `is_platform_admin`.

Proven in `apps/web/test/sign-in.test.ts` against real Postgres, with the
application's own connection repointed at `sessclone_app` so the policies are
actually in force — which is how the bootstrap's `returning` clauses were found
to fail their own select policies, and why the ids are generated in the
application instead.

**Not verified here:** the live click-through. This container reaches no
Supabase project and no GitHub OAuth app, so a real GitHub sign-in and a real
emailed link are the one thing the tests stand in for.
