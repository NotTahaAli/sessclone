import Link from 'next/link'

import { ADMIN_DESTINATIONS } from './navigation'
import { PageHeader } from '../(dashboard)/page-header'

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
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Platform"
        description="The deployment, rather than any one Org. Rates and Tiers are global; an Org Owner reaches none of this."
      />

      <ul className="flex flex-col gap-3">
        {ADMIN_DESTINATIONS.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="border-rule bg-surface hover:bg-surface-hover block rounded-md border p-4"
            >
              <span className="text-heading block">{item.label}</span>
              <span className="text-text-secondary mt-1 block text-sm">
                {ABOUT[item.href]}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
