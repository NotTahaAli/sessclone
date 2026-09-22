import { revokeKey } from './actions'
import { NewKeyForm } from './new-key-form'
import { EmptyState } from '../empty-state'
import { InstallCollector } from '../install-collector'
import { PageHeader } from '../page-header'
import {
  listApiKeys,
  listMemberships,
  type ApiKeyRow,
} from '../../../lib/api-keys'
import { appUrl } from '../../../lib/auth/app-url'
import { asViewer } from '../../../lib/db'
import { signedInUser } from '../../../lib/supabase/server'

// Ticket 28's surface: `/keys`, reachable by every Role, showing own keys only
// (`docs/design/product-ia.md`, "Signed-in surfaces"). "Own keys only" is not
// enforced here — `api_keys_own` enforces it, and this page has no `where`
// clause to get wrong.
//
// The stub header this page used to carry is gone: ticket 45's shell is above
// it now, and the Org name, the Role and sign out live there. What ticket 45
// added here instead is the install path, which the product IA requires be
// re-enterable from Keys — for a second machine, and for an Owner who wants
// the commands again without a new key.

// Ticket 51 gives the Org a timezone. Until then a date is shown in UTC and
// said to be, rather than in whatever zone the server happens to run in.
const when = (at: Date | null) =>
  at ? `${at.toISOString().slice(0, 16).replace('T', ' ')} UTC` : null

export default async function Keys() {
  const user = await signedInUser()

  // The shell above has already said so for every page under it, so this is
  // narrowing for the type checker rather than a second message.
  if (!user) return null

  // One round trip: two statements on the one transaction `asViewer` opens,
  // rather than two connections' worth of work for one page.
  const { memberships, keys } = await asViewer(user.id, async (tx) => ({
    memberships: await listMemberships(tx),
    keys: await listApiKeys(tx),
  }))

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Keys"
        description="A key lets a Collector report this machine's usage. Give each machine its own, so losing one costs you that machine and no other."
      />

      {keys.length === 0 ? (
        <EmptyState headline="No keys yet">
          You have no API key yet. The Collector needs one to report.
        </EmptyState>
      ) : (
        <KeyList keys={keys} />
      )}

      <NewKeyForm memberships={memberships} appUrl={appUrl()} />

      <section className="border-rule border-t pt-6">
        <h2 className="text-heading">Installing the Collector</h2>
        <p className="text-text-secondary mt-1 text-body">
          The same commands, whether this is your first machine or your fourth.
          A key is shown once at creation and never again, so the step below has
          a placeholder where yours goes — a key you have just created comes
          with the command already filled in.
        </p>
        <InstallCollector appUrl={appUrl()} />
      </section>
    </div>
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
