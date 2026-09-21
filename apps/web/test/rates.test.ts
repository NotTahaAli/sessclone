import { beforeEach, describe, expect, test } from 'vitest'

import {
  asRole,
  asUser,
  owner as sql,
  seedFixture,
  type Fixture,
  type FixtureOrg,
} from './harness'

// Ticket 23. The rate tables carry no behaviour of their own beyond two
// things, and both of them are money: what a row may say, and which row wins.
// Tickets 41, 42, 63 and 64 all resolve prices through
// `sessclone_resolve_rate`, so the precedence is proven once, here, rather
// than re-derived in each of them.

let fixture: Fixture

const CLASSES = [
  'input',
  'output',
  'cache_write_5m',
  'cache_write_1h',
  'cache_read',
  'web_search_request',
  'web_fetch_request',
]

const rate = (
  model: string | null,
  className: string,
  price: string,
  from: string,
) => sql`
  insert into rates (model, class, price_usd, effective_from)
  values (${model}, ${className}::rate_class, ${price}, ${from})
`

const override = (
  orgId: string,
  model: string | null,
  className: string,
  price: string,
  from: string,
) => sql`
  insert into org_rate_overrides (org_id, model, class, price_usd, effective_from)
  values (${orgId}, ${model}, ${className}::rate_class, ${price}, ${from})
`

const resolve = async (
  orgId: string | null,
  model: string | null,
  className: string,
  onDate: string,
) => {
  const [row] = await sql<{ price: string | null }[]>`
    select sessclone_resolve_rate(
      ${orgId}::uuid, ${model}, ${className}::rate_class, ${onDate}::date
    ) as price
  `
  return row!.price
}

beforeEach(async () => {
  fixture = await seedFixture()
})

describe('what a rate row can say', () => {
  test('covers all five token classes, both cache writes included', async () => {
    const [row] = await sql<{ labels: string[] }[]>`
      select array_agg(enumlabel::text order by enumsortorder) as labels
        from pg_enum where enumtypid = 'rate_class'::regtype
    `

    // ADR 0002: collapsing the two cache-write tiers makes the estimate wrong
    // by the gap between 2x and 1.25x, and the read price is a stored column
    // because its multiplier has exceptions.
    expect(row!.labels).toEqual(CLASSES)
  })

  test('prices a server-tool request alongside a token class, in its own unit', async () => {
    await rate(null, 'web_search_request', '10', '2026-09-12')
    await rate(null, 'web_fetch_request', '0', '2026-09-12')
    await rate('claude-opus-5', 'input', '5', '2026-09-12')

    const [units] = await sql<{ search: string; input: string }[]>`
      select sessclone_rate_unit('web_search_request') as search,
             sessclone_rate_unit('input') as input
    `

    expect(units).toEqual({ search: 'per_krequests', input: 'per_mtok' })

    // The free one is stored at zero rather than omitted, so the table stays
    // the single place a price change lands if it ever stops being free.
    expect(await resolve(null, null, 'web_fetch_request', '2026-09-20')).toBe(
      '0',
    )
  })

  test('refuses a second row for one model, class and date', async () => {
    await rate('claude-opus-5', 'input', '5', '2026-09-12')

    await expect(
      rate('claude-opus-5', 'input', '6', '2026-09-12'),
    ).rejects.toThrow(/rates_model_class_effective_from_key/)
  })

  test('refuses a second model-independent row for one class and date', async () => {
    // Two nulls are equal under `nulls not distinct`. Without it the
    // model-independent row could be inserted endlessly, and which one
    // resolved would be arbitrary.
    await rate(null, 'web_search_request', '10', '2026-09-12')

    await expect(
      rate(null, 'web_search_request', '11', '2026-09-12'),
    ).rejects.toThrow(/rates_model_class_effective_from_key/)
  })

  test('refuses a negative price', async () => {
    await expect(
      rate('claude-opus-5', 'input', '-1', '2026-09-12'),
    ).rejects.toThrow(/rates_price_usd_check/)
  })

  test('keeps a fractional price exactly, with no scale to round it away', async () => {
    // $0.025 per MTok is a real published cache-read price. A numeric with a
    // scale, or a float, is how an estimate acquires a drift nobody can
    // explain.
    await rate('claude-fable-5-1', 'cache_read', '0.025', '2026-09-12')

    expect(
      await resolve(null, 'claude-fable-5-1', 'cache_read', '2026-09-20'),
    ).toBe('0.025')
  })
})

describe('which rate wins', () => {
  test('the row in force on the date, not the latest one', async () => {
    await rate('claude-opus-5', 'input', '5', '2026-09-01')
    await rate('claude-opus-5', 'input', '7', '2026-10-01')

    // A Turn keeps the price that was live when it ran, which is the whole
    // reason `effective_from` exists.
    expect(await resolve(null, 'claude-opus-5', 'input', '2026-09-15')).toBe(
      '5',
    )
    expect(await resolve(null, 'claude-opus-5', 'input', '2026-10-02')).toBe(
      '7',
    )
  })

  test('nothing at all before the first effective date, rather than zero', async () => {
    await rate('claude-opus-5', 'input', '5', '2026-09-01')

    expect(
      await resolve(null, 'claude-opus-5', 'input', '2026-08-31'),
    ).toBeNull()
  })

  test('nothing for a model nobody has priced', async () => {
    await rate('claude-opus-5', 'input', '5', '2026-09-01')

    // ADR 0002: zero understates an Org's total while looking authoritative,
    // which is the worst failure available to a number about money.
    expect(
      await resolve(null, 'anthropic.claude-on-bedrock', 'input', '2026-09-15'),
    ).toBeNull()
  })

  test('a row naming the model beats a model-independent one', async () => {
    await rate(null, 'web_search_request', '10', '2026-09-01')
    await rate('claude-opus-5', 'web_search_request', '12', '2026-09-01')

    expect(
      await resolve(null, 'claude-opus-5', 'web_search_request', '2026-09-15'),
    ).toBe('12')
    expect(
      await resolve(
        null,
        'claude-haiku-4-5',
        'web_search_request',
        '2026-09-15',
      ),
    ).toBe('10')
  })

  test("an Org's override beats the platform table, even an older one", async () => {
    await rate('claude-opus-5', 'input', '5', '2026-09-01')
    await rate('claude-opus-5', 'input', '7', '2026-09-10')
    await override(fixture.acme.id, 'claude-opus-5', 'input', '3', '2026-09-02')

    // Negotiated pricing is not "the newest row anywhere": it is this Org's
    // price, and the platform list is only the fallback.
    expect(
      await resolve(fixture.acme.id, 'claude-opus-5', 'input', '2026-09-15'),
    ).toBe('3')
    // Another Org, and the platform list alone, are unaffected.
    expect(
      await resolve(fixture.globex.id, 'claude-opus-5', 'input', '2026-09-15'),
    ).toBe('7')
    expect(await resolve(null, 'claude-opus-5', 'input', '2026-09-15')).toBe(
      '7',
    )
  })

  test('an override that has not taken effect yet falls back to the platform price', async () => {
    await rate('claude-opus-5', 'input', '5', '2026-09-01')
    await override(fixture.acme.id, 'claude-opus-5', 'input', '3', '2026-10-01')

    expect(
      await resolve(fixture.acme.id, 'claude-opus-5', 'input', '2026-09-15'),
    ).toBe('5')
  })
})

const overridesVisibleTo = (org: FixtureOrg, role: 'owner' | 'member') =>
  asRole(
    org,
    role,
    (tx) =>
      tx<{ price_usd: string }[]>`select price_usd from org_rate_overrides`,
  )

describe('who may read and write a price', () => {
  beforeEach(async () => {
    await rate('claude-opus-5', 'input', '5', '2026-09-01')
    await override(fixture.acme.id, 'claude-opus-5', 'input', '3', '2026-09-01')
  })

  test('every signed-in Role reads the platform list', async () => {
    for (const role of ['owner', 'admin', 'manager', 'member'] as const) {
      // oxlint-disable-next-line no-await-in-loop -- four reads, order is clearer.
      const rows = await asRole(
        fixture.acme,
        role,
        (tx) => tx<{ price_usd: string }[]>`select price_usd from rates`,
      )
      expect(rows).toEqual([{ price_usd: '5' }])
    }
  })

  test('a caller with no claim reads no price at all', async () => {
    expect(
      await asUser(null, (tx) => tx<{ id: string }[]>`select id from rates`),
    ).toEqual([])
  })

  test('no Role writes the platform list, Owner included', async () => {
    // An Org Owner governs one Org. Global pricing is outside every Org, which
    // is why `is_platform_admin` is a flag on the user and not a fifth Role.
    await expect(
      asRole(
        fixture.acme,
        'owner',
        (tx) => tx`
          insert into rates (model, class, price_usd, effective_from)
          values ('claude-opus-5', 'output', 25, '2026-09-01')
        `,
      ),
    ).rejects.toThrow(/row-level security/)

    // An update whose `using` clause matches nothing is not an error in
    // Postgres — it is an update of no rows. The price is what to assert on.
    await asRole(
      fixture.acme,
      'owner',
      (tx) => tx`update rates set price_usd = 1`,
    )

    expect(
      await sql<{ price_usd: string }[]>`select price_usd from rates`,
    ).toEqual([{ price_usd: '5' }])
  })

  test('a Platform Admin writes it', async () => {
    await asUser(
      fixture.platformAdmin.userId,
      (tx) => tx`
        insert into rates (model, class, price_usd, effective_from)
        values ('claude-opus-5', 'output', 25, '2026-09-01')
      `,
    )

    expect(
      await sql<
        { n: number }[]
      >`select count(*)::int as n from rates where class = 'output'`,
    ).toEqual([{ n: 1 }])
  })

  test("an Org's override is invisible to every other Org", async () => {
    expect(await overridesVisibleTo(fixture.acme, 'member')).toEqual([
      { price_usd: '3' },
    ])
    expect(await overridesVisibleTo(fixture.globex, 'owner')).toEqual([])
  })

  test('an Owner cannot write themselves a discount', async () => {
    await expect(
      asRole(
        fixture.acme,
        'owner',
        (tx) => tx`
          insert into org_rate_overrides (org_id, model, class, price_usd, effective_from)
          values (${fixture.acme.id}, 'claude-opus-5', 'output', 0, '2026-09-01')
        `,
      ),
    ).rejects.toThrow(/row-level security/)
  })
})
