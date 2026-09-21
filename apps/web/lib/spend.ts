import type { TransactionSql } from 'postgres'

// Ticket 43: the read path that cannot accidentally present an unknown cost as
// a zero one.
//
// ADR 0002 is blunt about why this module exists at all: "Zero understates an
// Org's total while looking authoritative, which is the worst failure
// available to a number about money." `turn_costs` holds that line per Turn —
// `cost_usd` is null and `unpriced` is true when a quantity the Turn consumed
// has no Rate. The failure this file prevents is one level up: a caller that
// writes `sum(cost_usd)`, gets a number back, and shows it. `sum` skips nulls,
// so that number is the priced *subset* and nothing about it says so.
//
// So a total is not available here on its own. `orgSpend` returns the count of
// unpriced Turns beside it, in one round trip over one scan, and a caller that
// wants the figure has the caveat in the same object. Tickets 52 to 56 draw it.

/**
 * What an Org spent over a set of Turns, and what that figure leaves out.
 *
 * `costUsd` prices `pricedTurns` and no others. When `unpricedTurns` is
 * non-zero the figure is a floor, not a total, and the surface showing it says
 * so — `docs/design/dashboard-wireframes.md` gives that its own line rather
 * than hiding it.
 *
 * `costUsd` is a JavaScript number because it is a rendered estimate and not a
 * ledger: the arithmetic of record is `numeric` and happens in Postgres, and
 * this is the value that reaches a chart axis. A Turn with no Usage at all is
 * a priced zero and belongs in `pricedTurns`, which is why the two counts are
 * reported rather than one count and a subtraction.
 */
export type Spend = {
  costUsd: number
  pricedTurns: number
  unpricedTurns: number
}

/** A half-open window, as every date-bucketed read here takes it. */
export type Range = { from: Date; to: Date }

type SpendRow = {
  cost_usd: string | null
  priced_turns: string
  unpriced_turns: string
}

/**
 * The Org's spend, optionally over a window.
 *
 * Reads `turn_costs` directly rather than joining it to `turns`: since ticket
 * 81 the view carries `org_id` and `occurred_at`, so both quals push down to
 * `turns_org_occurred_at_idx` and only this Org's Turns are priced.
 *
 * `org_id` is a filter and not the authorisation. The view is
 * `security_invoker` and `turns_read` is what decides whose Turns the viewer
 * may see at all — a Manager's window onto their Scope, a Member's onto
 * themselves. Passing another Org's id returns nothing rather than something.
 */
export const orgSpend = async (
  tx: TransactionSql,
  orgId: string,
  range?: Range,
): Promise<Spend> => {
  const [row] = await tx<SpendRow[]>`
    select coalesce(sum(cost_usd), 0) as cost_usd,
           count(*) filter (where not unpriced) as priced_turns,
           count(*) filter (where unpriced) as unpriced_turns
      from turn_costs
     where org_id = ${orgId}
       ${range ? tx`and occurred_at >= ${range.from} and occurred_at < ${range.to}` : tx``}
  `

  return {
    costUsd: Number(row!.cost_usd ?? 0),
    pricedTurns: Number(row!.priced_turns),
    unpricedTurns: Number(row!.unpriced_turns),
  }
}

/** A model the rate table cannot price, and how much of it there is. */
export type UnknownModel = {
  model: string | null
  turns: number
  lastSeenAt: Date
}

/**
 * Every model identifier on the deployment that has no usable Rate.
 *
 * The operator's question, not an Org's — a rate is global and the person who
 * fixes a missing one is outside every Org. `sessclone_unknown_models()` is
 * `security definer` for that reason and checks the platform flag itself, so
 * this returns an empty list to everyone else rather than throwing: the
 * platform admin surface is ticket 62's to gate, and this is not a second
 * place where that decision lives.
 *
 * `model` is nullable because a Turn may carry no model at all — a transcript
 * that reported none — and that is exactly the case an operator wants to see
 * rather than have filtered away.
 */
export const unknownModels = async (
  tx: TransactionSql,
): Promise<UnknownModel[]> => {
  const rows = await tx<
    { model: string | null; turns: string; last_seen_at: Date }[]
  >`select model, turns, last_seen_at from sessclone_unknown_models()`

  return rows.map((row) => ({
    model: row.model,
    turns: Number(row.turns),
    lastSeenAt: row.last_seen_at,
  }))
}
