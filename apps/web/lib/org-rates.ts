import type { TransactionSql } from 'postgres'

import type { RateClass } from './rates'

// Ticket 64: an Org that negotiated its own pricing, and the estimates that
// have to match what it actually pays.
//
// The precedence is not written here. `sessclone_resolve_rate()` and the
// `turn_costs` view already prefer an override over the platform table and
// fall back when there is none (ticket 23's migration), so this module is the
// rows and nothing else — a second copy of the rule is a second answer that
// can drift from the first.
//
// Everything `lib/rates.ts` says about the platform list holds here for the
// same reasons: a price change is a new effective-dated row, never an edit,
// because `turn_costs` resolves on the Turn's own day and overwriting an old
// row rewrites what that day cost. There is no update statement in this file.
//
// Who may write is `org_rate_overrides_write`, which is the platform flag:
// negotiated pricing is agreed with the operator, and an Owner who could write
// this table could halve their own invoice. Who may *read* is the Org — every
// Cost its Members see comes from these rows, so hiding them would explain
// nothing — and no other Org, which `org_rate_overrides_read` enforces and the
// policy suite proves.

export type OrgRate = {
  id: string
  /** Null is the price that does not depend on the model, such as a search. */
  model: string | null
  class: RateClass
  priceUsd: number
  effectiveFrom: string
  note: string | null
  /** What the platform list charges for the same thing, for comparison. */
  platformUsd: number | null
  /**
   * True while this is the latest row for its model and class on or before
   * today. Not the same as "what prices a Turn": a row naming the model beats
   * a model-independent one, so both can be latest and only one of them
   * prices a Turn of that model (`sessclone_resolve_rate`).
   */
  current: boolean
}

type OrgRateRow = {
  id: string
  model: string | null
  class: RateClass
  price_usd: string
  effective_from: string
  note: string | null
  platform_usd: string | null
  current: boolean
}

/** Bounded like every other list, and generous: overrides are few per Org. */
export const OVERRIDE_PAGE = 200

/**
 * One Org's negotiated prices, with the published price beside each.
 *
 * The comparison is a lateral rather than a second query per row: an override
 * that reads as $3.00 means nothing without the $15.00 it replaces, and an
 * operator checking a contract should not have to hold the other page open.
 * It resolves the platform row the model's own row first, else the
 * model-independent one, latest on or before the day this override's price is
 * being compared on — today for the row in force, and the override's own start
 * date for a superseded or scheduled one. Comparing a live discount against a
 * list price that was replaced last week is how a 67% discount reads as 40%.
 */
export const listOrgRates = async (
  tx: TransactionSql,
  orgId: string,
  limit = OVERRIDE_PAGE,
): Promise<{ rates: OrgRate[]; more: boolean }> => {
  const rows = await tx<OrgRateRow[]>`
    with mine as (
      select override.id,
             override.model,
             override.class,
             override.price_usd,
             override.effective_from,
             override.note,
             coalesce(override.effective_from = max(override.effective_from)
               filter (where override.effective_from <= current_date)
               over (partition by override.model, override.class), false)
               as current
        from org_rate_overrides override
       where override.org_id = ${orgId}
       order by override.model nulls first, override.class,
                override.effective_from desc
       limit ${limit + 1}
    )
    select mine.id,
           mine.model,
           mine.class,
           mine.price_usd,
           to_char(mine.effective_from, 'YYYY-MM-DD') as effective_from,
           mine.note,
           mine.current,
           platform.price_usd as platform_usd
      from mine
      -- Lateral on the already-cut list rather than on the table: this is at
      -- most one index lookup per row shown, and it needs the current flag,
      -- which is a window and cannot be referenced from the same select.
      left join lateral (
        select rate.price_usd
          from rates rate
         where (rate.model = mine.model or rate.model is null)
           and rate.class = mine.class
           and rate.effective_from <= case when mine.current
                                           then current_date
                                           else mine.effective_from end
         order by (rate.model is not null) desc, rate.effective_from desc
         limit 1
      ) platform on true
     order by mine.model nulls first, mine.class, mine.effective_from desc
  `

  return {
    rates: rows.slice(0, limit).map((row) => ({
      id: row.id,
      model: row.model,
      class: row.class,
      priceUsd: Number(row.price_usd),
      effectiveFrom: row.effective_from,
      note: row.note,
      platformUsd: row.platform_usd === null ? null : Number(row.platform_usd),
      current: row.current,
    })),
    more: rows.length > limit,
  }
}

/**
 * The models the platform list names, for the form's `<datalist>`.
 *
 * A typo in the model field saves a row that matches no Turn and never will:
 * the Org keeps paying list price in its estimates while the page shows a
 * negotiated one. This is the same help ticket 63's page gives with its
 * unknown-model chips, from the other direction.
 *
 * The cap is a suggestion list and not the truth: past `limit` distinct
 * models the field still accepts anything typed into it, and a name it did
 * not suggest saves exactly as it would have. It is here so a `rates` table
 * that grows to thousands of rows cannot turn one admin page into a long
 * document.
 */
export const pricedModels = async (tx: TransactionSql, limit = 100) => {
  const rows = await tx<{ model: string }[]>`
    select distinct model from rates
     where model is not null
     order by model
     limit ${limit}
  `
  return rows.map((row) => row.model)
}

/**
 * Adds an override, effective from a date.
 *
 * Never an update, for the reason at the top of this file. The unique index
 * refuses a second row for the same Org, model, class and date; the operator
 * deletes and re-adds rather than typing over what a past day cost.
 */
export const addOrgRate = async (
  tx: TransactionSql,
  override: {
    orgId: string
    model: string | null
    class: RateClass
    priceUsd: number
    effectiveFrom: string
    note: string | null
  },
): Promise<string> => {
  const rows = await tx<{ id: string }[]>`
    insert into org_rate_overrides (org_id, model, class, price_usd,
                                    effective_from, note)
    values (${override.orgId}, ${override.model}, ${override.class},
            ${override.priceUsd}, ${override.effectiveFrom}, ${override.note})
    returning id
  `
  return rows[0]!.id
}

/**
 * Deletes an override.
 *
 * Every Turn that resolved to it reprices on the next read — to an earlier
 * override for that Org if one covers the day, else to the published price.
 * Nothing is backfilled because no Cost was ever stored (ADR 0002).
 *
 * Returns whether a row went, so a page cannot report a deletion the policy
 * refused. The id is scoped to the Org as well: an id is not a capability, and
 * `org_rate_overrides_write` is the platform flag rather than a per-Org one.
 */
export const deleteOrgRate = async (
  tx: TransactionSql,
  orgId: string,
  overrideId: string,
): Promise<boolean> => {
  const rows = await tx`
    delete from org_rate_overrides
     where id = ${overrideId} and org_id = ${orgId}
    returning id
  `
  return rows.length > 0
}
