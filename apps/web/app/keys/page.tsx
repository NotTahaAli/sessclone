import { revokeKey } from './actions'
import { NewKeyForm } from './new-key-form'
import {
  listApiKeys,
  listMemberships,
  type ApiKeyRow,
} from '../../lib/api-keys'
import { asViewer } from '../../lib/db'
import { signedInUser } from '../../lib/supabase/server'
import { Panel } from '../panel'

// Ticket 28's surface: `/keys`, reachable by every Role, showing own keys only
// (`docs/design/product-ia.md`, "Signed-in surfaces"). "Own keys only" is not
// enforced here — `api_keys_own` enforces it, and this page has no `where`
// clause to get wrong.
//
// The header and the credit under it are `app/panel.tsx`, shared with
// `/settings/you`. The real shell is ticket 45; until then that frame is what
// keeps "who am I signed in as" answerable on both.

// Ticket 51 gives the Org a timezone. Until then a date is shown in UTC and
// said to be, rather than in whatever zone the server happens to run in.
const when = (at: Date | null) =>
  at ? `${at.toISOString().slice(0, 16).replace('T', ' ')} UTC` : null

export default async function Keys() {
  const user = await signedInUser()

  // The Proxy redirects a signed-out visitor before this renders. Unconfigured
  // — no Supabase, no database — it does not, so say so plainly.
  if (!user) {
    return <main className="text-text p-6">Not signed in.</main>
  }

  // One round trip: two statements on the one transaction `asViewer` opens,
  // rather than two connections' worth of work for one page.
  const { memberships, keys } = await asViewer(user.id, async (tx) => ({
    memberships: await listMemberships(tx),
    keys: await listApiKeys(tx),
  }))

  return (
    <Panel email={user.email} memberships={memberships}>
      <h1 className="mt-6 text-2xl font-medium">Keys</h1>
      <p className="text-text-secondary mt-2 text-sm">
        A key lets a Collector report this machine&apos;s usage. Give each
        machine its own, so losing one costs you that machine and no other.
      </p>

      {keys.length === 0 ? (
        <p className="border-rule text-text-muted mt-6 rounded border border-dashed p-6 text-sm">
          No keys yet. Create one below, then install the Collector with it.
        </p>
      ) : (
        <KeyList keys={keys} />
      )}

      <NewKeyForm memberships={memberships} />
    </Panel>
  )
}

function KeyList({ keys }: { keys: ApiKeyRow[] }) {
  return (
    <table className="mt-6 w-full text-left text-sm">
      <thead className="text-text-muted border-rule-strong border-b">
        <tr>
          <th scope="col" className="py-2 font-normal">
            Label
          </th>
          <th scope="col" className="py-2 font-normal">
            Key
          </th>
          <th scope="col" className="py-2 font-normal">
            Org
          </th>
          <th scope="col" className="py-2 font-normal">
            Last used
          </th>
          <th scope="col" className="py-2 font-normal">
            <span className="sr-only">Revoke</span>
          </th>
        </tr>
      </thead>
      <tbody className="bg-surface">
        {keys.map((key) => (
          <tr key={key.id} className="border-rule border-b">
            <td className="py-2">{key.label}</td>
            <td className="text-text-muted py-2 font-mono">
              {key.key_prefix}…
            </td>
            {/* Which Org this key's Turns land in — the question the create
                form asks when there is more than one answer. */}
            <td className="text-text-muted py-2">{key.org_name}</td>
            {/* Written by ticket 34 on each accepted report. */}
            <td className="text-text-muted py-2">
              {when(key.last_used_at) ?? 'never used'}
            </td>
            <td className="py-2 text-right">
              {key.revoked_at ? (
                <span className="text-text-muted">
                  revoked {when(key.revoked_at)}
                </span>
              ) : (
                <RevokeButton id={key.id} label={key.label} />
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function RevokeButton({ id, label }: { id: string; label: string }) {
  return (
    <form action={revokeKey}>
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        className="border-control-border text-bad-text rounded border px-2 py-1"
      >
        Revoke<span className="sr-only"> {label}</span>
      </button>
    </form>
  )
}
