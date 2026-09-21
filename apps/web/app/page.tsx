import { signOut } from './sign-in/actions'
import { asViewer } from '../lib/db'
import { signedInUser } from '../lib/supabase/server'

// The whole dashboard is ticket 45. Until then this is the smallest page that
// makes ticket 27 observable: it names the Org the signed-in person owns, so
// "signing out and back in returns to the same Org" is something you can see
// rather than something the tests alone assert.
//
// The Org is read through `asViewer`, which is the only way anything here
// obtains a connection (ADR 0007) — so the name on this page arrived through
// the same policies that will decide every figure on the real dashboard.
export default async function Home() {
  const user = await signedInUser()

  // The Proxy redirects a signed-out visitor before this renders. Unconfigured
  // — no Supabase, no database — it does not, so say so plainly.
  if (!user) {
    return <main>Not signed in.</main>
  }

  const orgs = await asViewer(
    user.id,
    (tx) => tx<{ name: string }[]>`select name from orgs order by created_at`,
  )

  return (
    <main>
      <h1>sessclone</h1>
      <p>
        Signed in as {user.email}
        {orgs[0] ? <> · {orgs[0].name}</> : null}
      </p>
      <form action={signOut}>
        <button type="submit">Sign out</button>
      </form>
    </main>
  )
}
