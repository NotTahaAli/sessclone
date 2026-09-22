import { PageHeader } from '../page-header'
import { PendingLink } from '../pending-link'
import { moreItems } from '../navigation'
import { currentOperator } from '../../../lib/platform-admin'

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

export default async function More() {
  // The flag rather than a Role: no Role reaches the operator's area, and this
  // asks `sessclone_is_platform_admin()` — the same function the `/admin`
  // layout's own gate asks, so the entry and the refusal cannot disagree.
  const operator = await currentOperator()

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="More" />
      <ul className="flex flex-col gap-3">
        {moreItems(operator !== null).map((item) => (
          <li key={item.href}>
            <PendingLink
              href={item.href}
              className="border-rule bg-surface hover:bg-surface-hover block rounded-md border p-4"
            >
              <span className="text-heading block">{item.label}</span>
              <span className="text-text-secondary mt-1 block text-body">
                {ABOUT[item.href]}
              </span>
            </PendingLink>
          </li>
        ))}
      </ul>
    </div>
  )
}
