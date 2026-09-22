import { readFileSync } from 'node:fs'

import { beforeEach, expect, test, vi } from 'vitest'

import { readMarketingTiers, tierPrice, tierRetention } from '../lib/tiers'
import { anonymous, seedFixture, owner as sql, type Fixture } from './harness'

// Ticket 80: the public pricing section reads Tier records, so a price change
// on the admin page is live without a deploy.
//
// Against a real Postgres with the real migrations, because the thing being
// proved is that the page's numbers come from the table — a test against a
// literal would prove the literal.

/**
 * Every migration that shapes the Tier rows, in order. The strip of the
 * retention prose is one of them: re-applying the seed alone would restore
 * the lines a later migration deleted, and the suite would then be testing a
 * state no deployment is in.
 */
const SEEDS = [
  '20260922050000_tier_seed.sql',
  '20260922070000_tier_retention_prose.sql',
].map(
  (file) => new URL(`../../../supabase/migrations/${file}`, import.meta.url),
)

const revalidated = vi.fn()

let fixture: Fixture

beforeEach(async () => {
  fixture = await seedFixture()
  // The harness truncates between tests, so the seed migration's rows are
  // gone by the time one runs. Re-applied from the migration file rather than
  // from a copy of its numbers, as `costs.test.ts` does with the rate seed: a
  // test that restated the prices would pass while the migration said
  // something else.
  for (const seed of SEEDS) {
    // oxlint-disable-next-line no-await-in-loop
    await sql.unsafe(readFileSync(seed, 'utf8'))
  }
})

test('the four Tiers on the pricing page are the rows in the table', async () => {
  const tiers = await anonymous(readMarketingTiers)

  expect(tiers.map((tier) => tier.key)).toEqual([
    'self_hosted',
    'personal',
    'team',
    'enterprise',
  ])

  const team = tiers.find((tier) => tier.key === 'team')!
  expect(tierPrice(team)).toEqual({ amount: '$10', unit: 'per seat / month' })
  expect(team.retentionMaxDays).toBe(365)
  expect(team.archivalAvailable).toBe(true)
  // The card's prose is `features.includes`, so a Tier that starts including
  // something new is an edit rather than a deployment (ADR 0004).
  expect(team.includes).toContain(
    'Manager Scopes, so a lead sees their own people',
  )
})

test('a price change is visible on the next read, with nothing deployed', async () => {
  await sql`update tiers set seat_price_usd = 12 where key = 'team'`

  const tiers = await anonymous(readMarketingTiers)
  const team = tiers.find((tier) => tier.key === 'team')!

  expect(tierPrice(team)).toEqual({ amount: '$12', unit: 'per seat / month' })
})

test('a Tier with no price reads as Contact rather than as free', async () => {
  const tiers = await anonymous(readMarketingTiers)
  const enterprise = tiers.find((tier) => tier.key === 'enterprise')!

  // Both prices null, which is a real Tier and not a missing value. `Number`
  // of a null column would be 0, and 0 renders as Free — the failure this
  // ticket names explicitly and the one that costs the most.
  expect(enterprise.basePriceUsd).toBeNull()
  expect(enterprise.seatPriceUsd).toBeNull()
  expect(tierPrice(enterprise)).toEqual({ amount: 'Contact', unit: null })
})

test('a withdrawn Tier is not offered to somebody new', async () => {
  await sql`update tiers set available = false where key = 'personal'`

  const tiers = await anonymous(readMarketingTiers)

  expect(tiers.map((tier) => tier.key)).not.toContain('personal')
})

test('the pricing read is anonymous, and reaches nothing else', async () => {
  // Two halves, because neither proves it alone.
  //
  // The exported helper the pages actually call sets no claim: inside its own
  // transaction `sessclone_user_id()` is null, so every policy that tests it
  // refuses, whatever role the connection holds. A test that opened its own
  // anonymous connection instead would still pass if that helper started
  // setting one.
  const { readAnonymously } = await import('../lib/db')
  const [claim] = await readAnonymously(
    (tx) => tx<{ who: string | null }[]>`select sessclone_user_id() as who`,
  )
  expect(claim!.who).toBeNull()

  // And with the claim absent, on the unprivileged role a deployment must
  // point `DATABASE_URL` at, the policies answer nothing. `tiers_read` is
  // `using (true)` because published prices are public; every other table's
  // tests the claim above.
  const seen = await anonymous(
    (tx) => tx`select count(*)::int as count from orgs`,
  )
  expect(seen[0]!.count).toBe(0)

  // And the fixture's Orgs do exist — the zero above is the policy, not an
  // empty database.
  const [all] = await sql<{ count: number }[]>`
    select count(*)::int as count from orgs where id = ${fixture.acme.id}
  `
  expect(all!.count).toBe(1)
})

test('the read is cached under one tag, and both invalidators use it', async () => {
  // A source assertion, as `navigation.test.ts` makes for the platform gate:
  // what matters is not reachable from a unit test, because `use cache` needs
  // the Next runtime — and a cache nobody invalidates is a price that changes
  // on the admin page and not on the website.
  const read = readFileSync(new URL('../lib/tiers.ts', import.meta.url), 'utf8')
  expect(read).toContain("'use cache'")
  expect(read).toContain('cacheTag(TIERS_TAG)')

  // The Server Action's form, which expires the entry immediately so the
  // operator sees the price they just typed.
  const save = readFileSync(
    new URL('../app/admin/tiers/actions.ts', import.meta.url),
    'utf8',
  )
  expect(save).toContain('updateTag(TIERS_TAG)')

  // And the route handler's, because `updateTag` throws outside a Server
  // Action — this is the path a webhook or a hand-edited row takes.
  const route = readFileSync(
    new URL('../app/api/pricing/revalidate/route.ts', import.meta.url),
    'utf8',
  )
  expect(route).toContain("revalidateTag(TIERS_TAG, 'max')")
})

test('the revalidation route refuses without a secret, and with a wrong one', async () => {
  vi.doMock('next/cache', () => ({ revalidateTag: revalidated }))
  const { POST } = await import('../app/api/pricing/revalidate/route')

  const ask = (secret?: string) =>
    POST(
      new Request('https://sessclone.test/api/pricing/revalidate', {
        method: 'POST',
        headers: secret ? { authorization: `Bearer ${secret}` } : {},
      }),
    )

  // A deployment that has not set one refuses every call rather than
  // defaulting to open: this clears a cache, which is cheap to ask for over
  // and over.
  delete process.env.PRICING_REVALIDATE_SECRET
  expect((await ask('anything')).status).toBe(503)

  process.env.PRICING_REVALIDATE_SECRET = 'a-real-secret'
  expect((await ask()).status).toBe(401)
  expect((await ask('a-real-secre')).status).toBe(401)
  expect((await ask('a-real-secretx')).status).toBe(401)
  expect(revalidated).not.toHaveBeenCalled()

  expect((await ask('a-real-secret')).status).toBe(200)
  expect(revalidated).toHaveBeenCalledWith('tiers', 'max')

  delete process.env.PRICING_REVALIDATE_SECRET
})

test('the `features` a card renders survive whatever is in the column', async () => {
  // `features` is operator-editable jsonb, so `includesOf` is a parser over
  // input nobody validated at write time before ticket 80's own action did.
  // Each of these shapes reached a public page.
  const shapes: [unknown, string[]][] = [
    [
      { includes: ['Every Device', 'A year of history'] },
      ['Every Device', 'A year of history'],
    ],
    [{}, []],
    [{ includes: 'not a list' }, []],
    [{ includes: [1, 'kept', null] }, ['kept']],
    ['not an object at all', []],
  ]

  /* oxlint-disable no-await-in-loop -- each shape is written, read back and
     replaced by the next: run in parallel they would overwrite each other. */
  for (const [features, expected] of shapes) {
    await sql`
      update tiers set features = ${sql.json(features as never)},
                       description = null
       where key = 'personal'
    `
    const personal = (await anonymous(readMarketingTiers)).find(
      (tier) => tier.key === 'personal',
    )
    expect(personal!.includes).toEqual(expected)
    // Null description is an empty string, not the word "null" on a card.
    expect(personal!.description).toBe('')
  }
  /* oxlint-enable no-await-in-loop */
})

test('the retention ceiling on a card is the column, not prose', async () => {
  await sql`update tiers set retention_max_days = 730 where key = 'team'`

  const team = (await anonymous(readMarketingTiers)).find(
    (tier) => tier.key === 'team',
  )
  expect(tierRetention(team!)).toBe('2 years of history')
  // And the prose that used to say it is gone, so the two cannot disagree.
  expect(team!.includes.join(' ')).not.toMatch(/of history/i)
})

test('the seed never corrects a running deployment', () => {
  // A source assertion rather than a re-run: executing a migration mid-suite
  // is how the schema under every other test disappears. What matters is the
  // clause — `on conflict (key) do nothing` — because without it the next
  // deployment of a fresh checkout would reset every price an operator has
  // edited on /admin/tiers back to the numbers settled in September.
  const seed = readFileSync(
    new URL(
      '../../../supabase/migrations/20260922050000_tier_seed.sql',
      import.meta.url,
    ),
    'utf8',
  )
  expect(seed).toMatch(/on conflict \(key\) do nothing/i)
  expect(seed).not.toMatch(/do update/i)
})
