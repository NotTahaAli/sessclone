import { beforeEach, describe, expect, test } from 'vitest'

import {
  asRole,
  asUser,
  owner as sql,
  seedFixture,
  type Fixture,
  type FixtureOrg,
} from './harness'

// Ticket 24. Three things here are behaviour rather than shape, and each is a
// promise something later depends on: a Tier can express every plan the
// pricing page sells, an activation cannot happen without an event recording
// it, and a Log Artifact is readable by Role but destroyable only by the
// Member whose transcript it is.

let fixture: Fixture

const tier = async (
  key: string,
  extra: Record<string, unknown> = {},
): Promise<string> => {
  const row = {
    key,
    name: key,
    included_seats: 0,
    archival_available: false,
    ...extra,
  }
  const [created] = await sql<{ id: string }[]>`
    insert into tiers ${sql(row)} returning id
  `
  return created!.id
}

const subscribe = (orgId: string, tierId: string, status = 'inactive') => sql<
  { id: string }[]
>`
  insert into subscriptions (org_id, tier_id, status)
  values (${orgId}, ${tierId}, ${status}::subscription_status)
  returning id
`

const artifact = (org: FixtureOrg, role: 'member' | 'owner', session: string) =>
  sql<{ id: string }[]>`
    insert into log_artifacts
      (org_id, member_id, session_id, storage_key, sha256, size_bytes)
    values (
      ${org.id}, ${org.members[role]}, ${session},
      ${`${org.name}/${role}/${session}.jsonl`},
      ${'a'.repeat(64)}, 1024
    )
    returning id
  `

const eventStatusesIn = (org: FixtureOrg) =>
  asRole(
    org,
    'member',
    (tx) => tx<{ status: string }[]>`select status from subscription_events`,
  )

const artifactSessionsFor = async (
  org: FixtureOrg,
  role: Parameters<typeof asRole>[1],
) =>
  (
    await asRole(
      org,
      role,
      (tx) =>
        tx<{ session_id: string }[]>`select session_id from log_artifacts`,
    )
  )
    .map((row) => row.session_id)
    .toSorted()

beforeEach(async () => {
  fixture = await seedFixture()
})

describe('a Tier', () => {
  test('expresses a flat plan, a per-seat plan, and contact-us, in one shape', async () => {
    // The four tiers this product actually sells. A shape that cannot hold all
    // four is a shape that puts one of them in code.
    await tier('personal', {
      base_price_usd: 5,
      seat_price_usd: 0,
      included_seats: 1,
      min_seats: 1,
      max_seats: 1,
      retention_max_days: 30,
    })
    await tier('team', {
      seat_price_usd: 10,
      min_seats: 2,
      max_seats: 10,
      retention_max_days: 90,
      archival_available: true,
    })
    // Both prices null is "contact us" — a real Tier, not a missing value.
    await tier('enterprise', { archival_available: true })
    // No ceiling and no limit are both null rather than a sentinel: a sentinel
    // is a number that compares, and one day it compares wrongly.
    await tier('self_hosted', {
      base_price_usd: 0,
      seat_price_usd: 0,
      archival_available: true,
    })

    const rows = await sql<
      {
        key: string
        seat_price_usd: string | null
        retention_max_days: number | null
      }[]
    >`select key, seat_price_usd, retention_max_days from tiers order by key`

    expect(rows).toEqual([
      { key: 'enterprise', seat_price_usd: null, retention_max_days: null },
      { key: 'personal', seat_price_usd: '0', retention_max_days: 30 },
      { key: 'self_hosted', seat_price_usd: '0', retention_max_days: null },
      { key: 'team', seat_price_usd: '10', retention_max_days: 90 },
    ])
  })

  test('refuses a seat range that cannot be satisfied', async () => {
    await expect(
      tier('broken', { min_seats: 10, max_seats: 2 }),
    ).rejects.toThrow(/tiers_check/)
  })

  test('carries further gates as data, so the next one needs no migration', async () => {
    await tier('team', {
      features: sql.json({ sso: true, priority_support: false }),
    })

    const [row] = await sql<{ features: Record<string, boolean> }[]>`
      select features from tiers where key = 'team'
    `

    expect(row!.features).toEqual({ sso: true, priority_support: false })
  })

  test('is readable without a session at all, because it is the price list', async () => {
    // The landing page reads these (ticket 80) before anybody has signed in.
    await tier('team', { seat_price_usd: 10 })

    expect(
      await asUser(null, (tx) => tx<{ key: string }[]>`select key from tiers`),
    ).toEqual([{ key: 'team' }])
  })

  test('is not writable by an Org Owner', async () => {
    await expect(
      asRole(
        fixture.acme,
        'owner',
        (tx) => tx`
          insert into tiers (key, name, seat_price_usd)
          values ('free-for-me', 'Free', 0)
        `,
      ),
    ).rejects.toThrow(/row-level security/)
  })
})

describe('a subscription', () => {
  test('records a provider and its nullable identifiers, unread in v1', async () => {
    const tierId = await tier('team')
    await subscribe(fixture.acme.id, tierId)

    const [row] = await sql<
      {
        provider: string
        provider_customer_id: string | null
        provider_subscription_id: string | null
        provider_metadata: unknown
      }[]
    >`
      select provider, provider_customer_id, provider_subscription_id, provider_metadata
        from subscriptions
    `

    // ADR 0004: the nullable columns look like dead weight until a rail lands.
    // They are the reason landing one is not a migration.
    expect(row).toEqual({
      provider: 'manual',
      provider_customer_id: null,
      provider_subscription_id: null,
      provider_metadata: null,
    })
  })

  test('is one per Org, so an entitlement check reads one row', async () => {
    const tierId = await tier('team')
    await subscribe(fixture.acme.id, tierId)

    await expect(subscribe(fixture.acme.id, tierId)).rejects.toThrow(
      /subscriptions_org_id_key/,
    )
  })

  test('writes an event when it is created, and on every activation', async () => {
    const team = await tier('team')
    const [created] = await subscribe(fixture.acme.id, team)

    await sql`
      update subscriptions set status = 'active' where id = ${created!.id}
    `
    await sql`
      update subscriptions set status = 'cancelled' where id = ${created!.id}
    `

    const events = await sql<{ status: string }[]>`
      select status from subscription_events order by id
    `

    // The manual path is not a special case that skips the audit trail; it is
    // the first implementation of it.
    expect(events.map((row) => row.status)).toEqual([
      'inactive',
      'active',
      'cancelled',
    ])
  })

  test('writes one when the Tier changes, and none when nothing did', async () => {
    const team = await tier('team')
    const enterprise = await tier('enterprise')
    const [created] = await subscribe(fixture.acme.id, team, 'active')

    await sql`
      update subscriptions set tier_id = ${enterprise} where id = ${created!.id}
    `
    // A touch that changes neither status nor Tier is not an activation, and
    // an audit trail full of them is one nobody reads.
    await sql`
      update subscriptions set provider_customer_id = 'cus_1' where id = ${created!.id}
    `

    const events = await sql<{ tier_id: string }[]>`
      select tier_id from subscription_events order by id
    `

    expect(events.map((row) => row.tier_id)).toEqual([team, enterprise])
  })

  test('records who did it, from the claim on the connection', async () => {
    const team = await tier('team')

    // The note is the one part of the event the database cannot know, so it
    // travels on a transaction-local setting beside the write (ticket 48).
    await asUser(fixture.platformAdmin.userId, async (tx) => {
      await tx.unsafe(
        `set local sessclone.subscription_note = 'paid by bank transfer'`,
      )
      await tx`
        insert into subscriptions (org_id, tier_id, status)
        values (${fixture.acme.id}, ${team}, 'active')
      `
    })

    const [event] = await sql<
      { actor_user_id: string | null; note: string | null }[]
    >`select actor_user_id, note from subscription_events`

    expect(event).toEqual({
      actor_user_id: fixture.platformAdmin.userId,
      note: 'paid by bank transfer',
    })
  })

  test('cannot be activated by the Org that pays for it', async () => {
    const team = await tier('team')

    await expect(
      asRole(
        fixture.acme,
        'owner',
        (tx) => tx`
          insert into subscriptions (org_id, tier_id, status)
          values (${fixture.acme.id}, ${team}, 'active')
        `,
      ),
    ).rejects.toThrow(/row-level security/)
  })

  test('and its history is readable inside the Org and nowhere else', async () => {
    const team = await tier('team')
    await subscribe(fixture.acme.id, team, 'active')

    expect(await eventStatusesIn(fixture.acme)).toEqual([{ status: 'active' }])
    expect(await eventStatusesIn(fixture.globex)).toEqual([])
  })

  test('has an audit trail with exactly one author', async () => {
    const team = await tier('team')
    const [created] = await subscribe(fixture.acme.id, team)

    // No insert policy and no insert grant: the trigger is `security definer`
    // and writes as the owner, so an event can be neither forged nor
    // suppressed by anything the browser reaches.
    await expect(
      asUser(
        fixture.platformAdmin.userId,
        (tx) => tx`
          insert into subscription_events
            (subscription_id, org_id, status, tier_id, provider)
          values (${created!.id}, ${fixture.acme.id}, 'active', ${team}, 'manual')
        `,
      ),
    ).rejects.toThrow(/permission denied|row-level security/)
  })
})

describe('a Log Artifact', () => {
  test('records the Session, the object, its hash, size and upload time', async () => {
    await artifact(fixture.acme, 'member', 'session-1')

    const [row] = await sql<
      {
        session_id: string
        storage_key: string
        sha256: string
        size_bytes: string
        uploaded_at: Date
      }[]
    >`select session_id, storage_key, sha256, size_bytes, uploaded_at from log_artifacts`

    expect(row).toMatchObject({
      session_id: 'session-1',
      storage_key: 'Acme/member/session-1.jsonl',
      sha256: 'a'.repeat(64),
      size_bytes: '1024',
    })
    expect(row!.uploaded_at).toBeInstanceOf(Date)
  })

  test('refuses a hash that is not a SHA-256', async () => {
    await expect(sql`
      insert into log_artifacts
        (org_id, member_id, session_id, storage_key, sha256, size_bytes)
      values (${fixture.acme.id}, ${fixture.acme.members.member}, 's', 'k', 'nope', 1)
    `).rejects.toThrow(/log_artifacts_sha256_check/)
  })

  test('is one row per Session, replaced as the Session grows', async () => {
    // Ticket 59 replaces the object rather than accumulating versions, so a
    // second upload of a longer transcript updates this row.
    await artifact(fixture.acme, 'member', 'session-1')

    // A different object key, so it is the Session's identity that refuses
    // the second row and not the object's.
    await expect(sql`
      insert into log_artifacts
        (org_id, member_id, session_id, storage_key, sha256, size_bytes)
      values (
        ${fixture.acme.id}, ${fixture.acme.members.member}, 'session-1',
        'Acme/member/session-1.v2.jsonl', ${'b'.repeat(64)}, 2048
      )
    `).rejects.toThrow(/log_artifacts_member_id_session_id_agent_id_key/)
  })

  test('cannot name an object another row already names', async () => {
    await artifact(fixture.acme, 'member', 'session-1')

    await expect(sql`
      insert into log_artifacts
        (org_id, member_id, session_id, storage_key, sha256, size_bytes)
      values (
        ${fixture.acme.id}, ${fixture.acme.members.owner}, 'session-2',
        'Acme/member/session-1.jsonl', ${'b'.repeat(64)}, 1
      )
    `).rejects.toThrow(/log_artifacts_storage_key_key/)
  })

  test('is readable by exactly the Roles entitled to download it', async () => {
    await artifact(fixture.acme, 'member', 'member-session')
    await artifact(fixture.acme, 'owner', 'owner-session')
    await artifact(fixture.globex, 'member', 'globex-session')

    expect(await artifactSessionsFor(fixture.acme, 'owner')).toEqual([
      'member-session',
      'owner-session',
    ])
    expect(await artifactSessionsFor(fixture.acme, 'admin')).toEqual([
      'member-session',
      'owner-session',
    ])
    // The Manager's Scope is the fixture's one Member, and the Manager without
    // a Scope sees nothing — including nothing of the Owner's.
    expect(await artifactSessionsFor(fixture.acme, 'manager')).toEqual([
      'member-session',
    ])
    expect(
      await artifactSessionsFor(fixture.acme, 'managerWithoutScope'),
    ).toEqual([])
    expect(await artifactSessionsFor(fixture.acme, 'member')).toEqual([
      'member-session',
    ])
    expect(await artifactSessionsFor(fixture.globex, 'owner')).toEqual([
      'globex-session',
    ])
  })

  test('is destroyed by the Member whose transcript it is', async () => {
    await artifact(fixture.acme, 'member', 'member-session')

    await asRole(fixture.acme, 'member', (tx) => tx`delete from log_artifacts`)

    expect(await sql`select id from log_artifacts`).toEqual([])
  })

  test('and by nobody else, Owner included', async () => {
    await artifact(fixture.acme, 'member', 'member-session')

    // ADR 0005 keeps destroying a transcript inside the Member's decision.
    // An Admin may download it and may not destroy it — which is why the
    // delete policy is narrower than the read policy above.
    await asRole(fixture.acme, 'owner', (tx) => tx`delete from log_artifacts`)
    await asRole(fixture.acme, 'admin', (tx) => tx`delete from log_artifacts`)

    expect(await sql`select count(*)::int as n from log_artifacts`).toEqual([
      { n: 1 },
    ])
  })

  test('is not written by anything the browser can reach', async () => {
    // Rows are written by the presign route with the service role, after it
    // has verified an API key. Nothing else may claim an upload happened.
    await expect(
      asRole(
        fixture.acme,
        'member',
        (tx) => tx`
          insert into log_artifacts
            (org_id, member_id, session_id, storage_key, sha256, size_bytes)
          values (
            ${fixture.acme.id}, ${fixture.acme.members.member}, 'forged',
            'forged.jsonl', ${'c'.repeat(64)}, 1
          )
        `,
      ),
    ).rejects.toThrow(/permission denied|row-level security/)
  })
})
