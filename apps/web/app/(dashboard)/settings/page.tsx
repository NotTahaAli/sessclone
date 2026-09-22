import { PageHeader } from '../page-header'
import { PendingLink } from '../pending-link'
import { settingsFor } from '../navigation'
import { currentViewer } from '../../../lib/viewer'

// Settings: two destinations, listed according to what the Role reaches.
//
// They are separate destinations rather than two sections of one page, for the
// reason `docs/design/product-ia.md` gives at length: a page that is mostly
// refused reads as broken, and a Member opening a combined Settings would meet
// a list dominated by controls they cannot operate, on the one surface where
// the product is entirely about them.
//
// So Org settings is *absent* here for a Manager or a Member rather than
// present and disabled. A control that cannot be used is a question the reader
// cannot answer.

export default async function Settings() {
  const viewer = await currentViewer()
  if (!viewer) return null

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Settings" />
      <ul className="flex flex-col gap-3">
        {settingsFor(viewer.role).map((item) => (
          <li key={item.href}>
            <PendingLink
              href={item.href}
              className="border-rule bg-surface hover:bg-surface-hover block rounded-md border p-4"
            >
              <span className="text-heading block">{item.label}</span>
              <span className="text-text-secondary mt-1 block text-body">
                {item.about}
              </span>
            </PendingLink>
          </li>
        ))}
      </ul>
    </div>
  )
}
