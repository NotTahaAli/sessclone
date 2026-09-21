import { EmptyState } from '../empty-state'
import { InstallCollector } from '../install-collector'
import { PageHeader } from '../page-header'
import { appUrl } from '../../../lib/auth/app-url'
import { asViewer } from '../../../lib/db'
import {
  onboardingFacts,
  onboardingState,
  type OnboardingFacts,
} from '../../../lib/onboarding'
import { currentViewer } from '../../../lib/viewer'

// Costs, and — for now — mostly the states before there is anything to draw.
//
// The four views of spend are tickets 52 and 54 to 56, and the date range that
// governs them is ticket 53. What ticket 45 owns is the frame they hang from
// and what this surface says while those facts are still false. The facts
// themselves, and which state they put this page in, are `lib/onboarding.ts`.

/** The one action an empty Costs offers, hoisted so it is one object. */
const CREATE_A_KEY = { href: '/keys', label: 'Create a key' }

export default async function Costs() {
  const viewer = await currentViewer()
  // The layout above has already refused this case; the narrowing is for the
  // type checker rather than for a reader.
  if (!viewer) return null

  const facts = await asViewer(viewer.userId, (tx) =>
    onboardingFacts(tx, viewer.orgId),
  )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Costs"
        description={`What ${viewer.orgName} is spending, estimated from usage and published prices.`}
      />
      <Body facts={facts} />
    </div>
  )
}

function Body({ facts }: { facts: OnboardingFacts }) {
  switch (onboardingState(facts)) {
    // Drawing the Turns is tickets 52 to 56. Saying so plainly beats an empty
    // panel that looks like a bug.
    case 'collecting':
      return (
        <EmptyState headline="Collection is working">
          Turns are arriving. The charts that break them down by time, Member,
          Project and Device are still being built.
        </EmptyState>
      )

    case 'waiting':
      return <Waiting keyUsed={facts.key_used} />

    // No key and no Turn: the Collector has nothing to report with, so that is
    // the one thing worth saying. The sentence is the product IA's, for the
    // Keys surface's own day-one state.
    default:
      return (
        <EmptyState
          headline="Nothing has been collected yet"
          action={CREATE_A_KEY}
        >
          You have no API key yet. The Collector needs one to report.
        </EmptyState>
      )
  }
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
