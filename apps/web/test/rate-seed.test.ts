import { readFileSync } from 'node:fs'

import { beforeEach, describe, expect, test } from 'vitest'

import { owner as sql } from './harness'

// Ticket 41. Ticket 23 proved which row wins; this file proves the rows are
// there and say what the published page says.
//
// The harness truncates every table between tests, so the seed the migration
// applied is gone by the time a test runs. Re-applying the migration file
// itself — rather than a copy of its numbers — is the point: a test that
// restated the prices would pass while the migration said something else.
const SEED = new URL(
  '../../../supabase/migrations/20260921090000_rate_seed.sql',
  import.meta.url,
)

const applySeed = () => sql.unsafe(readFileSync(SEED, 'utf8'))

/** `sessclone_resolve_rate` as a number, with no Org in play. */
const resolve = async (model: string | null, className: string, on: string) => {
  const [row] = await sql<{ price: string | null }[]>`
    select sessclone_resolve_rate(
      null::uuid, ${model}, ${className}::rate_class, ${on}::date
    ) as price
  `
  return row!.price === null ? null : Number(row!.price)
}

beforeEach(applySeed)

describe('the seeded price list', () => {
  test('resolves every published class for a model on a date', async () => {
    // Claude Opus 5, as published on 2026-09-21.
    const opus = {
      input: await resolve('claude-opus-5', 'input', '2026-09-30'),
      output: await resolve('claude-opus-5', 'output', '2026-09-30'),
      cache_write_5m: await resolve(
        'claude-opus-5',
        'cache_write_5m',
        '2026-09-30',
      ),
      cache_write_1h: await resolve(
        'claude-opus-5',
        'cache_write_1h',
        '2026-09-30',
      ),
      cache_read: await resolve('claude-opus-5', 'cache_read', '2026-09-30'),
    }

    expect(opus).toEqual({
      input: 5,
      output: 25,
      cache_write_5m: 6.25,
      cache_write_1h: 10,
      cache_read: 0.5,
    })
  })

  test('records where each figure came from and when it was read', async () => {
    // ADR 0002: rates are maintained by reviewed migration, never scraped. A
    // price nobody can re-check against its source is a price nobody can fix.
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n from rates
       where source is null or source not like '%pricing read 2026-09-21'
    `
    expect(row!.n).toBe(0)
  })

  test('stores cache read as its own price, not input times a ratio', async () => {
    // The published multiplier is 0.1x — except on Claude Fable 5.1 and Claude
    // Mythos 5.1, where it is 0.025x. Anything deriving the read price from
    // base input is wrong by 4x on exactly the models this product runs most.
    const fableInput = await resolve('claude-fable-5-1', 'input', '2026-09-30')
    const fableRead = await resolve(
      'claude-fable-5-1',
      'cache_read',
      '2026-09-30',
    )

    expect(fableInput).toBe(10)
    expect(fableRead).toBe(0.25)
    expect(fableRead).not.toBe(fableInput! * 0.1)

    // And it is a stored row, not something the resolver computed: every
    // seeded model carries an explicit `cache_read` row of its own.
    const [counts] = await sql<{ models: number; reads: number }[]>`
      select count(distinct model) filter (where class = 'input')::int as models,
             count(*) filter (where class = 'cache_read')::int as reads
        from rates where model is not null
    `
    expect(counts!.reads).toBe(counts!.models)
  })

  test('prices the free server tool at zero rather than leaving it out', async () => {
    expect(await resolve(null, 'web_search_request', '2026-09-30')).toBe(10)
    // Zero and absent read the same on today's invoice and completely
    // differently the day web fetch stops being free.
    expect(
      await resolve('claude-opus-5', 'web_fetch_request', '2026-09-30'),
    ).toBe(0)
  })

  test('leaves a model it does not price unresolved, never zero', async () => {
    // A Bedrock id, and a retired model deliberately outside the seed. ADR
    // 0002: zero understates an Org's total while looking authoritative.
    expect(
      await resolve('anthropic.claude-opus-5', 'input', '2026-09-30'),
    ).toBeNull()
    expect(
      await resolve('claude-opus-4-1-20250805', 'input', '2026-09-30'),
    ).toBeNull()
  })

  test('holds the seeded price until a later row takes effect', async () => {
    await sql`
      insert into rates (model, class, price_usd, effective_from, source)
      values ('claude-opus-5', 'input', 6, '2026-11-01', 'a later price change')
    `

    // The day before the change, and the day of it. A Turn keeps the price
    // that was live when it ran.
    expect(await resolve('claude-opus-5', 'input', '2026-10-31')).toBe(5)
    expect(await resolve('claude-opus-5', 'input', '2026-11-01')).toBe(6)
    // And nothing at all before the seed's own effective date.
    expect(await resolve('claude-opus-5', 'input', '2026-09-20')).toBeNull()
  })
})
