import type { TransactionSql } from 'postgres'

// Ticket 65: the Tiers, as the operator defines them.
//
// The whole point of the table is that what a Tier includes is data (ADR
// 0004): seats, prices, the retention ceiling, whether archival is available,
// and `features` for every gate after those. So this module writes columns and
// never compares a Tier key — a key compared in code is the deployment the
// table exists to avoid, and ticket 47's last criterion is that there isn't
// one.
//
// `tiers_write` is the Platform Admin flag and nothing else. Every statement
// here is refused independently of any page that calls it.

export type AdminTier = {
  id: string
  key: string
  name: string
  description: string | null
  basePriceUsd: number | null
  seatPriceUsd: number | null
  includedSeats: number
  minSeats: number | null
  maxSeats: number | null
  retentionMaxDays: number | null
  archivalAvailable: boolean
  features: Record<string, unknown>
  sortOrder: number
  available: boolean
  /** Orgs on this Tier right now, so the operator can see what an edit moves. */
  orgs: number
}

type TierRow = Omit<
  AdminTier,
  | 'basePriceUsd'
  | 'seatPriceUsd'
  | 'includedSeats'
  | 'minSeats'
  | 'maxSeats'
  | 'retentionMaxDays'
  | 'archivalAvailable'
  | 'sortOrder'
  | 'orgs'
> & {
  base_price_usd: string | null
  seat_price_usd: string | null
  included_seats: number
  min_seats: number | null
  max_seats: number | null
  retention_max_days: number | null
  archival_available: boolean
  sort_order: number
  orgs: string
}

/**
 * The Tiers an Org can be put on, for a picker.
 *
 * `listTiers` counts the Orgs on every Tier, which is a page's question and
 * not a `<select>`'s: two columns in sort order is the whole of what a picker
 * needs, and `available` is here so an operator can see which Tier has been
 * withdrawn before putting somebody on it.
 */
export const tierChoices = (tx: TransactionSql) =>
  tx<{ id: string; name: string; available: boolean }[]>`
    select id, name, available from tiers order by sort_order, name
  `

/**
 * Every Tier, in the order the pricing page shows them.
 *
 * The Org count is a lateral aggregate rather than a second query per Tier:
 * the list is short, but a query in a loop is a bug at any length.
 */
export const listTiers = async (tx: TransactionSql): Promise<AdminTier[]> => {
  const rows = await tx<TierRow[]>`
    select tier.id, tier.key, tier.name, tier.description,
           tier.base_price_usd, tier.seat_price_usd, tier.included_seats,
           tier.min_seats, tier.max_seats, tier.retention_max_days,
           tier.archival_available, tier.features, tier.sort_order,
           tier.available,
           orgs.count as orgs
      from tiers tier
      left join lateral (
        select count(*) from subscriptions
         where subscriptions.tier_id = tier.id
           -- Ticket 137: the demo Orgs are not customers.
           and not exists (select 1 from orgs
                            where orgs.id = subscriptions.org_id and orgs.is_demo)
      ) orgs on true
     order by tier.sort_order, tier.name
  `

  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    // `numeric` arrives as a string, and null is not zero: null in both price
    // columns is "contact us", which a `?? 0` would turn into Free.
    basePriceUsd:
      row.base_price_usd === null ? null : Number(row.base_price_usd),
    seatPriceUsd:
      row.seat_price_usd === null ? null : Number(row.seat_price_usd),
    includedSeats: row.included_seats,
    minSeats: row.min_seats,
    maxSeats: row.max_seats,
    retentionMaxDays: row.retention_max_days,
    archivalAvailable: row.archival_available,
    features: row.features,
    sortOrder: row.sort_order,
    available: row.available,
    orgs: Number(row.orgs),
  }))
}

/**
 * A gate's value: a flag, a number, a string, or a list of lines.
 *
 * Never a nested object — `features` is read by comparing a key, so a shape
 * nobody can compare is a shape nobody uses. The list is the exception, and
 * it earns itself: `features.includes` is what the pricing cards render
 * (ticket 80), so a `features` editor that refuses an array refuses every
 * Tier the seed wrote — an operator could not change Team's price without
 * first deleting the card's own prose.
 */
export type FeatureValue = boolean | number | string | string[] | null

export type TierInput = {
  key: string
  name: string
  description: string | null
  basePriceUsd: number | null
  seatPriceUsd: number | null
  includedSeats: number
  minSeats: number | null
  maxSeats: number | null
  retentionMaxDays: number | null
  archivalAvailable: boolean
  features: Record<string, FeatureValue>
  sortOrder: number
  available: boolean
  /**
   * `create` refuses a key that already exists; `edit` replaces that
   * definition. Same statement either way, because the conflict is the only
   * difference — but an operator typing an existing key into the New Tier
   * form is not asking to replace the Tier every Org is already on.
   */
  mode: 'create' | 'edit'
}

/**
 * Creates a Tier, or replaces the definition of the one with that key.
 *
 * Returns false when nothing was written: a `create` whose key is taken, or a
 * caller `tiers_write` refuses.
 *
 * Keyed on `key` rather than on an id because the key is what an operator
 * types and what `CONTEXT.md` says is stable across renames. An edit is an
 * update in place, deliberately: a Tier is a definition and not an
 * effective-dated price like a Rate — the Orgs on it are on the Tier, whatever
 * it says today, and `subscription_events` is where the history of an Org's
 * entitlement lives.
 *
 * Capabilities take effect on the next read, with no deployment and no cache
 * to clear, which is ticket 65's third criterion.
 */
export const saveTier = async (
  tx: TransactionSql,
  tier: TierInput,
): Promise<boolean> => {
  const rows = await tx`
    insert into tiers (key, name, description, base_price_usd,
                       seat_price_usd, included_seats, min_seats, max_seats,
                       retention_max_days, archival_available, features,
                       sort_order, available)
    values (${tier.key}, ${tier.name}, ${tier.description},
            ${tier.basePriceUsd}, ${tier.seatPriceUsd}, ${tier.includedSeats},
            ${tier.minSeats}, ${tier.maxSeats}, ${tier.retentionMaxDays},
            ${tier.archivalAvailable}, ${tx.json(tier.features)},
            ${tier.sortOrder}, ${tier.available})
    ${
      tier.mode === 'create'
        ? tx`on conflict (key) do nothing`
        : tx`on conflict (key) do update
       set name = excluded.name,
           description = excluded.description,
           base_price_usd = excluded.base_price_usd,
           seat_price_usd = excluded.seat_price_usd,
           included_seats = excluded.included_seats,
           min_seats = excluded.min_seats,
           max_seats = excluded.max_seats,
           retention_max_days = excluded.retention_max_days,
           archival_available = excluded.archival_available,
           features = excluded.features,
           sort_order = excluded.sort_order,
           available = excluded.available`
    }
    returning id
  `
  // Refused by `tiers_write`, or a key already taken: nothing was written,
  // and the page says so.
  return rows.length > 0
}
