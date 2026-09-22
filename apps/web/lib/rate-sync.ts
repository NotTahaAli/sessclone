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
// carries the model table as a plain pipe table.

export const PRICING_URL =
  'https://platform.claude.com/docs/en/about-claude/pricing.md'

/** What `source` records: the page as a reader would open it, and the day. */
const sourceFor = (day: string) =>
  `https://platform.claude.com/docs/en/about-claude/pricing read ${day}`

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
    models.push({
      // "Claude Mythos 5.1 ([limited availability](…))" keeps only the name.
      model: modelId(name!.replace(/\(.*$/, '')),
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

type Existing = { model: string; class: string; price: number }

/**
 * What would have to be published for the rates table to match the page.
 *
 * `existing` is the latest row per (model, class), future-dated ones included,
 * so a change already scheduled is not proposed twice. A dated snapshot id
 * (`claude-opus-4-5-20251101`) takes its alias's published prices, because a
 * Turn records whichever string the client sent.
 */
export const proposeChanges = (
  published: PublishedModel[],
  existing: Existing[],
  today: string,
): Proposal[] => {
  const latest = new Map(
    existing.map((row) => [`${row.model}|${row.class}`, row.price]),
  )
  const known = new Set(existing.map((row) => row.model))

  const proposals: Proposal[] = []
  for (const { model, prices } of published) {
    const snapshot = new RegExp(`^${model}-\\d{8}$`)
    const ids = [model, ...[...known].filter((id) => snapshot.test(id))]
    for (const id of ids) {
      const changes: Change[] = []
      for (const column of COLUMNS) {
        const from = latest.get(`${id}|${column}`) ?? null
        if (from === prices[column]) continue
        changes.push({
          class: column,
          from,
          to: prices[column],
          // A price change holds from today; yesterday still costs what it
          // cost. A class never priced reaches back so waiting Turns price.
          effectiveFrom: from === null ? EPOCH : today,
        })
      }
      if (changes.length > 0) proposals.push({ model: id, changes })
    }
  }
  return proposals.toSorted((a, b) => a.model.localeCompare(b.model))
}

/** Reads the published page. Server-side only; the browser never fetches it. */
export const fetchPublished = async () => {
  const response = await fetch(PRICING_URL, {
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`pricing page answered ${response.status}`)
  return parsePricing(await response.text())
}

/** The latest row per (model, class) for the five token classes, in one read. */
const latestRates = async (tx: TransactionSql) => {
  const rows = await tx<{ model: string; class: string; price_usd: string }[]>`
    select distinct on (model, class) model, class, price_usd
      from rates
     where model is not null and class::text = any(${[...COLUMNS]})
     order by model, class, effective_from desc
  `
  return rows.map((row) => ({
    model: row.model,
    class: row.class,
    price: Number(row.price_usd),
  }))
}

export const pendingProposals = async (
  tx: TransactionSql,
  published: PublishedModel[],
  today: string,
) => proposeChanges(published, await latestRates(tx), today)

/**
 * Publishes the approved proposals, all or nothing: one transaction, so a
 * refused row leaves no half-updated model behind. Returns the rows written.
 */
export const applyProposals = async (
  tx: TransactionSql,
  proposals: Proposal[],
  today: string,
) => {
  const rows = proposals.flatMap((proposal) =>
    proposal.changes.map((change) => ({
      model: proposal.model,
      class: change.class,
      price_usd: change.to,
      effective_from: change.effectiveFrom,
      source: sourceFor(today),
    })),
  )
  if (rows.length === 0) return 0
  await tx`insert into rates ${tx(rows)}`
  return rows.length
}
