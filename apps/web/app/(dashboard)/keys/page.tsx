import { revokeKey } from './actions'
import { NewKeyForm } from './new-key-form'
import { EmptyState } from '../empty-state'
import { InstallCollector } from '../install-collector'
import { PageHeader } from '../page-header'
import { Row, SectionBreak } from '../../_ui/primitives'
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
// What ticket 45 added here is the install path, which the product IA requires
// be re-enterable from Keys — for a second machine, and for an Owner who wants
// the commands again without a new key.
//
// Direction A (ticket 112): the create field first, then one row per key —
// ✓ once it has reported, ○ before that or once revoked — with Revoke on the
// right, then the install steps under a section break.

// Ticket 51 gives the Org a timezone. Until then a date is shown in UTC and
// said to be, rather than in whatever zone the server happens to run in.
const when = (at: Date | null) =>
  at ? `${at.toISOString().slice(0, 16).replace('T', ' ')} UTC` : null

export default async function Keys() {
  const user = await signedInUser()

  // The shell above has already said so for every page under it, so this is
  // narrowing for the type checker rather than a second message.
  if (!user) return null

  // One round trip: two statements on the one transaction `asViewer` opens.
  const { memberships, keys } = await asViewer(user.id, async (tx) => ({
    memberships: await listMemberships(tx),
    keys: await listApiKeys(tx),
  }))

  return (
    <div className="flex max-w-3xl flex-col">
      <PageHeader title="Keys" />
      <p className="text-text-muted mt-3 text-caption">
        A key lets a Collector report this machine&apos;s usage. Give each
        machine its own, so losing one costs you that machine and no other.
      </p>

      <NewKeyForm memberships={memberships} appUrl={appUrl()} />

      <SectionBreak>Your keys</SectionBreak>
      {keys.length === 0 ? (
        <EmptyState headline="No keys yet">
          You have no API key yet. The Collector needs one to report.
        </EmptyState>
      ) : (
        <KeyList keys={keys} />
      )}

      <SectionBreak>Install the Collector</SectionBreak>
      <p className="text-text-muted text-caption">
        The same commands, whether this is your first machine or your fourth. A
        key is shown once at creation and never again, so the step below has a
        placeholder where yours goes — a key you have just created comes with
        the command already filled in.
      </p>
      <InstallCollector appUrl={appUrl()} />
    </div>
  )
}

function KeyList({ keys }: { keys: ApiKeyRow[] }) {
  return (
    <ol>
      {keys.map((key) => (
        <li key={key.id} className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <Row
              lead={key.last_used_at && !key.revoked_at ? 'ok' : 'idle'}
              meta={key.revoked_at ? 'revoked' : undefined}
              // Which Org this key's Turns land in — the question the create
              // form asks when there is more than one answer — and when it was
              // last used, which ticket 34 writes on each accepted report.
              sub={
                <>
                  <span className="font-mono">{key.key_prefix}…</span> ·{' '}
                  {key.org_name} ·{' '}
                  {key.revoked_at
                    ? `revoked ${when(key.revoked_at)}`
                    : key.last_used_at
                      ? `last used ${when(key.last_used_at)}`
                      : 'never used'}
                </>
              }
            >
              <span className={key.revoked_at ? 'text-text-muted' : ''}>
                {key.label}
              </span>
            </Row>
          </div>
          {key.revoked_at ? null : (
            <RevokeButton id={key.id} label={key.label} />
          )}
        </li>
      ))}
    </ol>
  )
}

function RevokeButton({ id, label }: { id: string; label: string }) {
  return (
    <form action={revokeKey}>
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        className="text-text-muted hover:text-bad-text text-caption underline"
      >
        Revoke<span className="sr-only"> {label}</span>
      </button>
    </form>
  )
}
