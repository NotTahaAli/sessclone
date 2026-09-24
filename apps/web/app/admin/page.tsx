import { ADMIN_DESTINATIONS } from './navigation'
import { PageHeader } from '../(dashboard)/page-header'
import { Row } from '../_ui/primitives'

// The landing the navigation points at, saying what the deployment's operator
// governs from here and what each destination holds. The gate is the layout's.

const ABOUT: Record<string, string> = {
  '/admin/rates':
    'The published price list, effective-dated, and the model identifiers no rate can price yet.',
  '/admin/tiers':
    'Seats, price and capabilities. A change takes effect without a deployment.',
  '/admin/orgs':
    'Every Org on this deployment: its Tier, its subscription history, and any rate it has negotiated.',
}

export default function PlatformAdmin() {
  return (
    <div className="flex max-w-3xl flex-col">
      <PageHeader title="Platform" />
      <p className="text-text-muted mt-3 mb-2 text-caption">
        The deployment, rather than any one Org. Rates and Tiers are global; an
        Org Owner reaches none of this.
      </p>
      <ol>
        {ADMIN_DESTINATIONS.map((item) => (
          <li key={item.href}>
            <Row href={item.href} name={item.label} sub={ABOUT[item.href]} />
          </li>
        ))}
      </ol>
    </div>
  )
}
