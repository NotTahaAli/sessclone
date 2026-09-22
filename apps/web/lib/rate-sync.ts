import type { TransactionSql } from 'postgres'

import type { RateClass } from './rates'

// Ticket 97: fetch the published price list and propose what changed.
//
// ADR 0002 keeps rates out of reach of a scraper, and this does not change
// that: nothing here writes a price the operator has not looked at. The page
// is read, compared with the rates table, and each model whose prices differ
// becomes one proposal the operator approves or ignores. Applying re-reads the
// page on the server rather than trusting prices posted back by the browser,
// so the only thing a request can choose is which model ids to accept.
//
// The source is the page ticket 41 seeded from, in its markdown form, which
// carries the model table as a plain pipe table. It is `PRICING_URL`, not a
// constant: no external host is compiled into the application
// (`packages/shared/src/configuration.test.ts`), so a deployment that leaves
// it unset gets a button that says so rather than a call it did not choose.

/** The page to read, or null when this deployment has not named one. */
export const pricingUrl = () => process.env.PRICING_URL?.trim() || null

/** What `source` records: the page as a reader would open it, and the day. */
const sourceFor = (url: string, day: string) =>
  `${url.replace(/\.md$/, '')} read ${day}`

/**
 * The date a model never priced before is priced from. Memory and ticket 41:
 * rows reach back to the project epoch so Turns already collected on the model
 * resolve priced, and a model only ever appears on Turns after it shipped.
 */
const EPOCH = '2026-01-01'

// The five columns of the model table, in the page's order. Server-tool rates
// are prose on the page, not a table, and stay a hand-entered row.
const COLUMNS = [
  'input',
  'cache_write_5m',
  'cache_write_1h',
  'cache_read',
  'output',
] as const satisfies readonly RateClass[]

export type TokenClass = (typeof COLUMNS)[number]
export type PublishedModel = {
  model: string
  prices: Record<TokenClass, number>
}

/** "Claude Opus 5.5" → "claude-opus-5-5", the id a Turn records. */
const modelId = (name: string) =>
  name.trim().toLowerCase().replaceAll('.', '-').replace(/\s+/g, '-')

/** "$0.25 / MTok<sup>1</sup>" → 0.25; anything else is not a price. */
const price = (cell: string) => {
  const match = /^\$(\d+(?:\.\d+)?)\s*\/\s*MTok\b/.exec(cell.trim())
  return match ? Number(match[1]) : null
}

/**
 * The model table of the pricing page, one entry per active model.
 *
 * Throws rather than returning a short list when the table is not where it
 * was: a page that changed shape must read as "could not read the page", never
 * as "no changes".
 */
export const parsePricing = (markdown: string): PublishedModel[] => {
  const lines = markdown.split('\n')
  const header = lines.findIndex(
    (line) => line.startsWith('|') && /Base input tokens/i.test(line),
  )
  if (header < 0) throw new Error('pricing table not found')

  const models: PublishedModel[] = []
  const seen = new Set<string>()
  // Header, then the `|---|` separator, then rows until the table ends.
  for (const line of lines.slice(header + 2)) {
    if (!line.startsWith('|')) break
    const cells = line.split('|').slice(1, -1)
    if (cells.length !== 6) throw new Error(`unexpected row: ${line}`)
    const [name, ...rest] = cells
    // Retired models are left out, as the seed left them out: nothing this
    // product ingests can have run on them.
    if (/retired/i.test(name!)) continue
    const read = (index: number) => {
      const value = price(rest[index]!)
      if (value === null) throw new Error(`unreadable price in: ${line}`)
      return value
    }
    // "Claude Mythos 5.1 ([limited availability](…))" keeps only the name.
    const model = modelId(name!.replace(/\(.*$/, ''))
    // A name the mapping does not turn into a plain id (markup, a footnote, a
    // legacy "Claude 3 Haiku") is refused rather than proposed: a junk id
    // would read as a new model and be priced back to the epoch.
    if (!/^claude-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(model)) {
      throw new Error(`unrecognised model name: ${name!.trim()}`)
    }
    // Two rows under one id would be two proposals colliding on insert.
    if (seen.has(model)) throw new Error(`model listed twice: ${model}`)
    seen.add(model)
    models.push({
      model,
      prices: {
        input: read(0),
        cache_write_5m: read(1),
        cache_write_1h: read(2),
        cache_read: read(3),
        output: read(4),
      },
    })
  }
  if (models.length === 0) throw new Error('pricing table is empty')
  return models
}

export type Change = {
  class: TokenClass
  /** Null when the model has no row for this class yet. */
  from: number | null
  to: number
  effectiveFrom: string
}

export type Proposal = {
  /** The id the rows are written under: the alias, or a dated snapshot. */
  model: string
  changes: Change[]
}

type Existing = {
  model: string
  class: string
  /** In force today, or null when nothing is yet. */
  price: number | null
  /** A row dated after today exists: a change the operator already scheduled. */
  scheduled: boolean
}

/**
 * What would have to be published for the rates table to match the page.
 *
 * `existing` is the row in force today per (model, class). A class with a
 * future-dated row is left alone: the operator scheduled that change, and a
 * proposal from today would be overtaken by it on its date. A dated snapshot id
 * (`claude-opus-4-5-20251101`) takes its alias's published prices, because a
 * Turn records whichever string the client sent.
 */
export const proposeChanges = (
  published: PublishedModel[],
  existing: Existing[],
  today: string,
): Proposal[] => {
  const current = new Map(
    existing.map((row) => [`${row.model}|${row.class}`, row]),
  )
  const known = new Set(existing.map((row) => row.model))

  const proposals: Proposal[] = []
  for (const { model, prices } of published) {
    const ids = [
      model,
      ...[...known].filter(
        (id) =>
          id.startsWith(`${model}-`) &&
          /^\d{8}$/.test(id.slice(model.length + 1)),
      ),
    ]
    for (const id of ids) {
      const changes: Change[] = []
      for (const column of COLUMNS) {
        const row = current.get(`${id}|${column}`)
        if (row?.scheduled) continue
        const from = row?.price ?? null
        if (from === prices[column]) continue
        changes.push({
          class: column,
          from,
          to: prices[column],
          // A price change holds from today; yesterday still costs what it
          // cost. A class never priced reaches back so waiting Turns price.
          // A class with no row at all reaches back; one whose only rows are
          // in the future is `scheduled` and skipped above.
          effectiveFrom: from === null ? EPOCH : today,
        })
      }
      if (changes.length > 0) proposals.push({ model: id, changes })
    }
  }
  return proposals.toSorted((a, b) => a.model.localeCompare(b.model))
}

/** Reads the published page. Server-side only; the browser never fetches it. */
export const fetchPublished = async (url: string) => {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`pricing page answered ${response.status}`)
  return parsePricing(await response.text())
}

/**
 * Per (model, class) for the five token classes, in one read: the price in
 * force on `today`, and whether a later row is already scheduled.
 */
const currentRates = async (tx: TransactionSql, today: string) => {
  const rows = await tx<
    {
      model: string
      class: string
      price_usd: string | null
      scheduled: boolean
    }[]
  >`
    select model, class::text as class,
           (array_agg(price_usd order by effective_from desc)
              filter (where effective_from <= ${today}::date))[1] as price_usd,
           bool_or(effective_from > ${today}::date) as scheduled
      from rates
     where model is not null and class::text = any(${[...COLUMNS]})
     group by model, class
  `
  return rows.map((row) => ({
    model: row.model,
    class: row.class,
    price: row.price_usd === null ? null : Number(row.price_usd),
    scheduled: row.scheduled,
  }))
}

export const pendingProposals = async (
  tx: TransactionSql,
  published: PublishedModel[],
  today: string,
) => proposeChanges(published, await currentRates(tx, today), today)

/**
 * What the operator saw for one proposal, as the browser posts it back. Apply
 * writes only proposals whose fresh fingerprint equals the one reviewed, so a
 * page that changed between Fetch and Apply is refused rather than published
 * unseen. The posted value is compared, never written.
 */
export const fingerprint = (proposal: Proposal) =>
  JSON.stringify(proposal.changes)

/**
 * The fresh proposals the operator approved, or null when any approved one no
 * longer matches what they reviewed (or no longer exists).
 */
export const approvedProposals = (
  fresh: Proposal[],
  reviewed: Map<string, string>,
): Proposal[] | null => {
  const chosen = fresh.filter((proposal) => reviewed.has(proposal.model))
  if (chosen.length !== reviewed.size) return null
  return chosen.every(
    (proposal) => reviewed.get(proposal.model) === fingerprint(proposal),
  )
    ? chosen
    : null
}

/**
 * Publishes the approved proposals, all or nothing: one transaction, so a
 * refused row leaves no half-updated model behind. Returns the rows written.
 */
export const applyProposals = async (
  tx: TransactionSql,
  proposals: Proposal[],
  today: string,
  url: string,
) => {
  const rows = proposals.flatMap((proposal) =>
    proposal.changes.map((change) => ({
      model: proposal.model,
      class: change.class,
      price_usd: change.to,
      effective_from: change.effectiveFrom,
      source: sourceFor(url, today),
    })),
  )
  if (rows.length === 0) return 0
  await tx`insert into rates ${tx(rows)}`
  return rows.length
}
