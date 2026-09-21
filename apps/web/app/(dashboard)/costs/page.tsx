import { EmptyState } from '../empty-state'
import { InstallCollector } from '../install-collector'
import { PageHeader } from '../page-header'
import { appUrl } from '../../../lib/auth/app-url'
import { asViewer } from '../../../lib/db'
import { currentViewer } from '../../../lib/viewer'

// Costs, and — for now — mostly the states before there is anything to draw.
//
// The four views of spend are tickets 52 and 54 to 56, and the date range that
// governs them is ticket 53. What ticket 45 owns is the frame they hang from
// and what this surface says while those facts are still false, which
// `docs/design/product-ia.md` is emphatic about: onboarding "is not a modal
// over the dashboard and not a separate wizard route. It is what the dashboard
// shows while those facts are still false."
//
// **The state is observed, never stored.** There is no `onboarding_step`
// column and no "completed setup" boolean, and the three reads below are the
// three facts the IA names. That is what makes it resumable, survive signing
// out halfway, and — the reason it matters — unable to lie: a flag says setup
// finished, observed state says a Turn arrived, and those differ exactly when
// something has gone wrong.
//
// Each read is policy-scoped, so "any Turn" already means "any Turn this
// person may see" without a `where` clause here to get wrong (ADR 0001).

/** The one action an empty Costs offers, hoisted so it is one object. */
const CREATE_A_KEY = { href: '/keys', label: 'Create a key' }

type Facts = {
  has_key: boolean
  key_used: boolean
  any_turns: boolean
}

export default async function Costs() {
  const viewer = await currentViewer()
  // The layout above has already refused this case; the narrowing is for the
  // type checker rather than for a reader.
  if (!viewer) return null

  const [facts] = await asViewer(
    viewer.userId,
    (tx) => tx<Facts[]>`
      select
        exists (select 1 from api_keys where revoked_at is null) as has_key,
        exists (
          select 1 from api_keys
           where revoked_at is null and last_used_at is not null
        ) as key_used,
        -- No where clause here either, and the reason is the point: an
        -- Owner whose engineers have been collecting for a week, but who has
        -- not run a Collector themselves, is not still onboarding. The
        -- turns_read policy already narrows a Member to their own Turns and a
        -- Manager to their Scope, so this is the right answer for every Role
        -- for free. exists and not count(*), because the branch below asks
        -- whether there is a Turn and nothing renders the number.
        exists (select 1 from turns) as any_turns
    `,
  )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Costs"
        description={`What ${viewer.orgName} is spending, estimated from usage and published prices.`}
      />
      <Body facts={facts!} />
    </div>
  )
}

function Body({ facts }: { facts: Facts }) {
  // No key: the Collector has nothing to report with, so that is the one thing
  // worth saying. The sentence is the product IA's, for the Keys surface's own
  // day-one state.
  if (!facts.has_key) {
    return (
      <EmptyState
        headline="Nothing has been collected yet"
        action={CREATE_A_KEY}
      >
        You have no API key yet. The Collector needs one to report.
      </EmptyState>
    )
  }

  if (!facts.any_turns) return <Waiting keyUsed={facts.key_used} />

  // Turns exist, and drawing them is tickets 52 to 56. Saying so plainly beats
  // an empty panel that looks like a bug.
  return (
    <EmptyState headline="Collection is working">
      Turns are arriving. The charts that break them down by time, Member,
      Project and Device are still being built.
    </EmptyState>
  )
}

/**
 * The most important screen in the product: a key exists and no Turn has
 * arrived.
 *
 * Two states, not one, and the difference is the last-used time on the key.
 * A key that has never been used means the Collector has not reached this
 * deployment at all; a key that has means it reached us and the problem is
 * downstream of the key rather than in it. From this surface those are
 * otherwise indistinguishable — a report with an unknown or revoked key writes
 * nothing (ticket 34), so it looks exactly like silence.
 *
 * Ticket 39 owns the polling and the list of causes that grows over time.
 * This is the shell's version: say which of the two states it is, and show the
 * install path again.
 */
function Waiting({ keyUsed }: { keyUsed: boolean }) {
  return (
    <section>
      <div className="border-rule bg-surface max-w-3xl rounded-md border p-6">
        <h2 className="text-heading">Waiting for the first Turn</h2>
        <p className="text-text-secondary mt-2 text-body">
          {keyUsed
            ? 'A Collector has reached this deployment with one of your keys, but no Turn has landed yet. The key is not the problem.'
            : 'No Collector has reported with one of your keys yet. The Collector reports when a turn ends, so nothing arrives until one does.'}
        </p>
      </div>

      <InstallCollector appUrl={appUrl()} />
    </section>
  )
}
