import { PageHeader } from '../page-header'
import { PendingLink } from '../pending-link'
import { moreItems } from '../navigation'
import { asViewer } from '../../../lib/db'
import { currentOperator } from '../../../lib/platform-admin'
import { pendingOrgCount } from '../../../lib/subscriptions'

// Ticket 85: what the phone's More entry opens.
//
// Six destinations do not fit a bottom bar, so it carries the first group —
// Costs, Sessions and Transcripts, which is what a person opens the dashboard
// to read — and this page carries the rest. The setup surfaces end up one tap
// further rather than absent, which is the trade the ticket asked for.
//
// A destination rather than a sheet rising out of the bar. It is a page, like
// `/settings` already is: no client JavaScript, the browser's back button
// undoes it, a link to it can be sent, and the bottom bar marks More as
// current through the same `usePathname` comparison every other entry uses.
//
// It is reachable at every width, and the desktop sidebar does not link to it
// because the sidebar has room for all six. That is deliberate rather than an
// omission: a link that renders differently per viewport is a second list to
// keep in agreement, and this one is generated from the groups themselves.

/** What each entry is for, said once here rather than guessed at per width. */
const ABOUT: Record<string, string> = {
  '/keys': 'The API keys your Collectors report with.',
  '/devices': 'The machines that have reported, and what they are called.',
  '/settings': 'Your settings, and your Org’s.',
  '/admin': 'Rates, Tiers and Orgs for this deployment.',
}

/** The row primitive's box, for a `PendingLink` (which `Row` does not take). */
const ROW =
  'hover:bg-surface-hover -mx-2.5 block rounded-md px-2.5 py-[9px] text-body'

export default async function More() {
  // The flag rather than a Role: no Role reaches the operator's area, and this
  // asks `sessclone_is_platform_admin()` — the same function the `/admin`
  // layout's own gate asks, so the entry and the refusal cannot disagree.
  const operator = await currentOperator()
  // Ticket 120: the phone's way to the Admin panel carries the count too.
  const pending = operator
    ? await asViewer(operator.userId, pendingOrgCount)
    : 0

  return (
    <div className="flex max-w-3xl flex-col">
      <PageHeader title="More" />
      {/* Direction A (ticket 112): plain rows with chevrons, one per
          destination, what it is for on the line under. */}
      <ul className="mt-2">
        {moreItems(operator !== null).map((item) => (
          <li key={item.href}>
            <PendingLink href={item.href} className={ROW}>
              <span className="grid grid-cols-[14px_minmax(0,1fr)] gap-x-2">
                <span
                  aria-hidden="true"
                  className="text-text-muted text-[13px]"
                >
                  ›
                </span>
                <span>
                  {item.label}
                  {item.href === '/admin' && pending > 0
                    ? ` · ${pending} waiting for approval`
                    : ''}
                </span>
                <span className="text-text-muted col-start-2 text-caption">
                  {ABOUT[item.href]}
                </span>
              </span>
            </PendingLink>
          </li>
        ))}
      </ul>
    </div>
  )
}
