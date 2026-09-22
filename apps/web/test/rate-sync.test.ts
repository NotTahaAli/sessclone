import { readFileSync } from 'node:fs'

import { beforeEach, describe, expect, test } from 'vitest'

import { asUser, owner as sql, seedFixture } from './harness'
import {
  applyProposals,
  parsePricing,
  pendingProposals,
} from '../lib/rate-sync'

// Ticket 97. The page is parsed from rows copied verbatim from
// https://platform.claude.com/docs/en/about-claude/pricing.md on 2026-09-22,
// including the footnote markup and the retired and limited-availability
// suffixes that a model id must not carry.
const PAGE = `
## Model pricing

| Model | Base input tokens | 5m cache writes | 1h cache writes | Cache hits and refreshes | Output tokens |
|---|---|---|---|---|---|
| Claude Mythos 5.1 ([limited availability](https://anthropic.com/glasswing))                                                           | $10 / MTok        | $12.50 / MTok   | $20 / MTok      | $0.25 / MTok<sup>1</sup> | $50 / MTok    |
| Claude Opus 5.5                                                                                                                       | $4 / MTok         | $5 / MTok       | $8 / MTok       | $0.20 / MTok<sup>2</sup> | $20 / MTok    |
| Claude Opus 4.5                                                                                                                       | $5 / MTok         | $6.25 / MTok    | $10 / MTok      | $0.50 / MTok             | $25 / MTok    |
| Claude Opus 4.1 ([retired, except on Bedrock and Google Cloud](https://platform.claude.com/docs/en/about-claude/model-deprecations))  | $15 / MTok        | $18.75 / MTok   | $30 / MTok      | $1.50 / MTok             | $75 / MTok    |

*<sup>1 Cache hits and refreshes on Claude Fable 5.1 and Claude Mythos 5.1 are priced at 0.025x the base input price.</sup>*
`

const SEED = new URL(
  '../../../supabase/migrations/20260921090000_rate_seed.sql',
  import.meta.url,
)

describe('parsing the published page', () => {
  test('reads active models under the id a Turn records', () => {
    expect(parsePricing(PAGE)).toEqual([
      {
        model: 'claude-mythos-5-1',
        prices: {
          input: 10,
          cache_write_5m: 12.5,
          cache_write_1h: 20,
          cache_read: 0.25,
          output: 50,
        },
      },
      {
        model: 'claude-opus-5-5',
        prices: {
          input: 4,
          cache_write_5m: 5,
          cache_write_1h: 8,
          cache_read: 0.2,
          output: 20,
        },
      },
      {
        model: 'claude-opus-4-5',
        prices: {
          input: 5,
          cache_write_5m: 6.25,
          cache_write_1h: 10,
          cache_read: 0.5,
          output: 25,
        },
      },
    ])
  })

  // A page that changed shape must never read as "nothing changed".
  test('refuses a page without the table or with an unreadable price', () => {
    expect(() => parsePricing('# Pricing\n\nNo table.')).toThrow()
    expect(() =>
      parsePricing(PAGE.replace('$4 / MTok', 'Contact sales')),
    ).toThrow()
  })
})

describe('proposing and applying against the seeded list', () => {
  beforeEach(async () => {
    await sql.unsafe(readFileSync(SEED, 'utf8'))
  })

  test('a new model reaches back to the epoch; a changed one holds from today', async () => {
    // A cut to the alias's input price, so the dated snapshot must follow it.
    const page = parsePricing(
      PAGE.replace(
        '| $5 / MTok         | $6.25',
        '| $4.50 / MTok      | $6.25',
      ),
    )
    const proposals = await sql.begin((tx) =>
      pendingProposals(tx, page, '2026-09-22'),
    )

    expect(proposals).toEqual([
      {
        model: 'claude-opus-4-5',
        changes: [
          { class: 'input', from: 5, to: 4.5, effectiveFrom: '2026-09-22' },
        ],
      },
      {
        model: 'claude-opus-4-5-20251101',
        changes: [
          { class: 'input', from: 5, to: 4.5, effectiveFrom: '2026-09-22' },
        ],
      },
      {
        model: 'claude-opus-5-5',
        changes: [
          { class: 'input', from: null, to: 4, effectiveFrom: '2026-01-01' },
          {
            class: 'cache_write_5m',
            from: null,
            to: 5,
            effectiveFrom: '2026-01-01',
          },
          {
            class: 'cache_write_1h',
            from: null,
            to: 8,
            effectiveFrom: '2026-01-01',
          },
          {
            class: 'cache_read',
            from: null,
            to: 0.2,
            effectiveFrom: '2026-01-01',
          },
          { class: 'output', from: null, to: 20, effectiveFrom: '2026-01-01' },
        ],
      },
    ])
  })

  test('applied as the operator, it prices Turns and proposes nothing more', async () => {
    const fixture = await seedFixture()
    const page = parsePricing(PAGE)

    await asUser(fixture.platformAdmin.userId, async (tx) =>
      applyProposals(
        tx,
        await pendingProposals(tx, page, '2026-09-22'),
        '2026-09-22',
      ),
    )

    const [row] = await sql<{ price: string }[]>`
      select sessclone_resolve_rate(
        null::uuid, 'claude-opus-5-5', 'output'::rate_class, '2026-05-01'::date
      ) as price
    `
    expect(Number(row!.price)).toBe(20)
    expect(
      await sql.begin((tx) => pendingProposals(tx, page, '2026-09-22')),
    ).toEqual([])
  })

  test('refused for anyone but the operator', async () => {
    const fixture = await seedFixture()
    const page = parsePricing(PAGE)
    const someone = fixture.acme.users.owner

    await expect(
      asUser(someone, async (tx) =>
        applyProposals(
          tx,
          await pendingProposals(tx, page, '2026-09-22'),
          '2026-09-22',
        ),
      ),
    ).rejects.toThrow(/row-level security/)
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n from rates where model = 'claude-opus-5-5'
    `
    expect(row!.n).toBe(0)
  })
})
