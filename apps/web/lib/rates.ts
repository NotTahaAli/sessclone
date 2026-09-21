import type { TransactionSql } from 'postgres'

// Ticket 63: the published price list, as the operator maintains it.
//
// Two rules the surface cannot be allowed to break, both from ADR 0002:
//
// A price change is a new effective-dated row, never an edit of an old one.
// `turn_costs` resolves the Rate live on the Turn's own day, so overwriting
// yesterday's price rewrites what yesterday cost — silently, for every Org,
// with nothing to compare against. Nothing in this module updates a rate.
//
// Adding a Rate reprices history by itself. There is no backfill and nothing
// to run: a Turn that was unpriced becomes priced on the next read, because
// the Cost was never stored. That is why the unknown-model list and the
// add-a-rate form belong on one page.
//
// Who may write is `rates_write`, which is the platform flag and nothing else
// (ADR 0001). This module never checks it.

export const RATE_CLASSES = [
  'input',
  'output',
  'cache_write_5m',
  'cache_write_1h',
  'cache_read',
  'web_search_request',
  'web_fetch_request',
] as const

export type RateClass = (typeof RATE_CLASSES)[number]

export type Rate = {
  id: string
  /** Null is the price that does not depend on the model, such as a search. */
  model: string | null
  class: RateClass
  priceUsd: number
  effectiveFrom: string
  source: string | null
  /**
   * True while this is the row a Turn priced today would resolve to. A later
   * row for the same model and class supersedes it, and the old row stays
   * because it is still what last month cost.
   */
  current: boolean
}

type RateRow = {
  id: string
  model: string | null
  class: RateClass
  price_usd: string
  effective_from: string
  source: string | null
  current: boolean
}

/** Per million tokens, or per thousand requests: the class decides. */
export const rateUnit = (rateClass: RateClass) =>
  rateClass === 'web_search_request' || rateClass === 'web_fetch_request'
    ? 'per 1,000 requests'
    : 'per MTok'

/**
 * Every Rate, newest effective date first, with the current one marked.
 *
 * Bounded, like every other list in this app. A deployment with more than a
 * page of rates wants a filter on this screen rather than a longer page, and
 * `more` is what lets the page say the list was cut.
 */
export const listRates = async (
  tx: TransactionSql,
  options: { model?: string | null; limit?: number } = {},
): Promise<{ rates: Rate[]; more: boolean }> => {
  const { model = null, limit = 200 } = options

  const rows = await tx<RateRow[]>`
    select id, model, class, price_usd, source,
           -- As text, so a date the operator typed comes back the day they
           -- typed rather than shifted by the reader's timezone.
           to_char(effective_from, 'YYYY-MM-DD') as effective_from,
           -- The latest row for this (model, class) whose date has arrived.
           -- Not the same question as which Rate prices a Turn:
           -- sessclone_resolve_rate prefers a row naming the model over a
           -- model-independent one, and an Org's override over both. The page
           -- says "latest", not "in force", for that reason.
           -- coalesce, because the aggregate is null for a (model, class)
           -- whose rows are all future-dated, and the flag is a boolean.
           coalesce(effective_from = max(effective_from) filter (
             where effective_from <= current_date
           ) over (partition by model, class), false) as current
      from rates
     -- The filter is what makes the cap liveable: a deployment that prices
     -- twenty models across seven classes crosses 200 rows in two price
     -- revisions, and this page is the only place a rate can be deleted.
     ${model ? tx`where model ilike ${`%${model}%`}` : tx``}
     order by model nulls first, class, effective_from desc
     limit ${limit + 1}
  `

  return {
    rates: rows.slice(0, limit).map((row) => ({
      id: row.id,
      model: row.model,
      class: row.class,
      priceUsd: Number(row.price_usd),
      effectiveFrom: row.effective_from,
      source: row.source,
      current: row.current,
    })),
    more: rows.length > limit,
  }
}

/**
 * Adds a Rate, effective from a date.
 *
 * Never an update. The unique index refuses a second row for the same model,
 * class and date, and that refusal is the answer: an operator correcting a
 * price they entered today is changing what today costs, which is a decision
 * they take deliberately by deleting the row rather than by typing over it.
 */
export const addRate = async (
  tx: TransactionSql,
  rate: {
    model: string | null
    class: RateClass
    priceUsd: number
    effectiveFrom: string
    source: string | null
  },
): Promise<string> => {
  const rows = await tx<{ id: string }[]>`
    insert into rates (model, class, price_usd, effective_from, source)
    values (${rate.model}, ${rate.class}, ${rate.priceUsd},
            ${rate.effectiveFrom}, ${rate.source})
    returning id
  `
  return rows[0]!.id
}

/**
 * Deletes a Rate.
 *
 * The correction path, and deliberately blunt: a price published by mistake is
 * removed, not edited, so the row that priced a Turn either exists or does
 * not. Every Turn that resolved to it reprices on the next read — back to
 * whatever earlier row covers that day, or to unpriced (ADR 0002).
 *
 * Returns whether a row went: `rates_write` refuses an Org Owner silently, and
 * the page says nothing happened rather than claiming a deletion.
 */
export const deleteRate = async (
  tx: TransactionSql,
  rateId: string,
): Promise<boolean> => {
  const rows = await tx`delete from rates where id = ${rateId} returning id`
  return rows.length > 0
}
