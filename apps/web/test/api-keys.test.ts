import { createHash } from 'node:crypto'

import { beforeEach, describe, expect, test, vi } from 'vitest'

import {
  createApiKey,
  generateApiKey,
  hashApiKey,
  listApiKeys,
  listMemberships,
  revokeApiKey,
} from '../lib/api-keys'
import { asUser, owner, seedFixture, type Fixture } from './harness'

// Ticket 28. Two halves, tested at the two levels they belong at.
//
// The secret's shape and its hash are pure functions, so they are asserted
// directly. Everything that touches a row goes through `asUser` — the same
// claim-setting transaction `asViewer` opens for the dashboard — because
// `api_keys_own` is the only thing standing between one Member's keys and
// another's, and a query run on the owner connection proves nothing about it.

let fixture: Fixture

beforeEach(async () => {
  fixture = await seedFixture()
})

describe('the secret itself', () => {
  test('is greppable, high-entropy, and its prefix is the front of it', () => {
    const { key, prefix, hash } = generateApiKey()

    // `sk_` so a key spilled into a log or a repository can be found by
    // searching for it, rather than only by recognising 43 random characters.
    expect(key.startsWith('sk_')).toBe(true)
    expect(key.startsWith(prefix)).toBe(true)

    // What the column accepts, and enough of the key to tell two apart.
    expect(prefix.length).toBeGreaterThanOrEqual(4)
    expect(prefix.length).toBeLessThanOrEqual(16)

    // 32 random bytes, base64url: 43 characters after the `sk_`.
    expect(key.length).toBe(3 + 43)

    expect(hash).toBe(createHash('sha256').update(key).digest('hex'))
    expect(hash).not.toContain(key.slice(3))
  })

  test('is never the same twice', () => {
    const keys = new Set(Array.from({ length: 64 }, () => generateApiKey().key))

    expect(keys.size).toBe(64)
  })

  test('verifies by recomputing the hash — what ticket 34 does per request', () => {
    const { key, hash } = generateApiKey()

    expect(hashApiKey(key)).toBe(hash)
    expect(hashApiKey(`${key}x`)).not.toBe(hash)
  })
})

describe('creating a key', () => {
  test('stores the hash and the prefix, and nothing that can be replayed', async () => {
    const key = await asUser(fixture.acme.users.member, (tx) =>
      createApiKey(tx, 'laptop'),
    )

    // Read back on the owner connection: the question is what is in the
    // table, not what a policy will show, so this deliberately bypasses them.
    const [row] = await owner<Record<string, unknown>[]>`
      select * from api_keys
    `

    expect(row).toMatchObject({
      member_id: fixture.acme.members.member,
      label: 'laptop',
      key_hash: hashApiKey(key),
      key_prefix: key.slice(0, 12),
      last_used_at: null,
      revoked_at: null,
    })

    // The secret is in no column, under no name.
    const stored = JSON.stringify(row)
    expect(stored).not.toContain(key)
    expect(stored).not.toContain(key.slice(12))
  })

  test('shows the key in full exactly once: nothing can read it back', async () => {
    const key = await asUser(fixture.acme.users.member, (tx) =>
      createApiKey(tx, 'laptop'),
    )

    const listed = await asUser(fixture.acme.users.member, (tx) =>
      listApiKeys(tx, fixture.acme.members.member),
    )

    expect(listed).toHaveLength(1)
    expect(JSON.stringify(listed)).not.toContain(key)
    expect(listed[0]).toMatchObject({
      label: 'laptop',
      key_prefix: key.slice(0, 12),
      last_used_at: null,
      revoked_at: null,
    })
  })

  test('lets several live at once, each with its own label', async () => {
    await asUser(fixture.acme.users.member, async (tx) => {
      await createApiKey(tx, 'laptop')
      await createApiKey(tx, 'desktop')
    })

    const listed = await asUser(fixture.acme.users.member, (tx) =>
      listApiKeys(tx, fixture.acme.members.member),
    )

    expect(listed.map((row) => row.label)).toEqual(['desktop', 'laptop'])
    expect(listed.every((row) => row.revoked_at === null)).toBe(true)
  })
})

describe('an Org waiting for approval (ticket 119)', () => {
  test('cannot create a key until it is approved', async () => {
    vi.stubEnv('SIGNUP_APPROVAL', undefined)
    try {
      await expect(
        asUser(fixture.acme.users.member, (tx) => createApiKey(tx, 'laptop')),
      ).rejects.toThrow(/no membership to issue a key for/)

      const [tier] = await owner<{ id: string }[]>`
        insert into tiers (key, name) values ('team', 'Team') returning id
      `
      await owner`
        insert into subscriptions (org_id, tier_id, status)
        values (${fixture.acme.id}, ${tier!.id}, 'active')
      `
      await expect(
        asUser(fixture.acme.users.member, (tx) => createApiKey(tx, 'laptop')),
      ).resolves.toMatch(/^sk_/)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe('another Member', () => {
  test('cannot read the key, list it, or revoke it', async () => {
    const id = await asUser(fixture.acme.users.member, async (tx) => {
      await createApiKey(tx, 'laptop')
      const [only] = await listApiKeys(tx, fixture.acme.members.member)
      return only!.id
    })

    // In the same Org, and an Admin at that: a key is personal, and
    // `api_keys_own` gives nobody else a way to it.
    const seen = await asUser(fixture.acme.users.admin, (tx) =>
      listApiKeys(tx, fixture.acme.members.admin),
    )
    expect(seen).toEqual([])

    // Named directly. The row exists and the id is spelled out, so the policy
    // is the only thing refusing it.
    const named = await asUser(
      fixture.acme.users.admin,
      (tx) => tx`select id from api_keys where id = ${id}`,
    )
    expect(named).toEqual([])

    await asUser(fixture.acme.users.admin, (tx) => revokeApiKey(tx, id))
    await asUser(fixture.globex.users.member, (tx) => revokeApiKey(tx, id))

    const [row] = await owner<{ revoked_at: Date | null }[]>`
      select revoked_at from api_keys where id = ${id}
    `
    expect(row!.revoked_at).toBeNull()
  })
})

describe('revocation', () => {
  test('takes effect immediately and touches only that key', async () => {
    const listed = await asUser(fixture.acme.users.member, async (tx) => {
      await createApiKey(tx, 'laptop')
      await createApiKey(tx, 'desktop')
      return listApiKeys(tx, fixture.acme.members.member)
    })

    const doomed = listed.find((row) => row.label === 'laptop')!

    await asUser(fixture.acme.users.member, (tx) => revokeApiKey(tx, doomed.id))

    const after = await asUser(fixture.acme.users.member, (tx) =>
      listApiKeys(tx, fixture.acme.members.member),
    )
    const byLabel = new Map(after.map((row) => [row.label, row]))

    expect(byLabel.get('laptop')!.revoked_at).toBeInstanceOf(Date)
    expect(byLabel.get('desktop')!.revoked_at).toBeNull()
  })

  test('cannot be undone, even by the key’s own Member', async () => {
    const id = await asUser(fixture.acme.users.member, async (tx) => {
      await createApiKey(tx, 'laptop')
      const [only] = await listApiKeys(tx, fixture.acme.members.member)
      await revokeApiKey(tx, only!.id)
      return only!.id
    })

    await expect(
      asUser(
        fixture.acme.users.member,
        (tx) => tx`update api_keys set revoked_at = null where id = ${id}`,
      ),
    ).rejects.toThrow(/cannot be un-revoked/)

    const [row] = await owner<{ revoked_at: Date | null }[]>`
      select revoked_at from api_keys where id = ${id}
    `
    expect(row!.revoked_at).toBeInstanceOf(Date)
  })
})

describe('a Member of more than one Org', () => {
  /** Adds the Acme Member to Globex too, and returns that second member id. */
  const alsoInGlobex = async () => {
    const [row] = await owner<{ id: string }[]>`
      insert into members (org_id, user_id, role)
      values (${fixture.globex.id}, ${fixture.acme.users.member}, 'member')
      returning id
    `
    return row!.id
  }

  test('sees both memberships, and each key says which Org it reports to', async () => {
    const second = await alsoInGlobex()

    const memberships = await asUser(fixture.acme.users.member, listMemberships)
    expect(memberships).toEqual([
      { member_id: fixture.acme.members.member, org_name: 'Acme' },
      { member_id: second, org_name: 'Globex' },
    ])

    await asUser(fixture.acme.users.member, (tx) =>
      createApiKey(tx, 'laptop', second),
    )

    const listed = await asUser(fixture.acme.users.member, (tx) =>
      listApiKeys(tx, second),
    )
    expect(listed).toMatchObject([{ label: 'laptop', org_name: 'Globex' }])
  })

  test('is asked which Org rather than given the oldest one', async () => {
    await alsoInGlobex()

    await expect(
      asUser(fixture.acme.users.member, (tx) => createApiKey(tx, 'laptop')),
    ).rejects.toThrow(/choose which org/)

    const [row] = await owner<{ count: string }[]>`
      select count(*) from api_keys
    `
    expect(row!.count).toBe('0')
  })

  test('cannot issue a key against somebody else’s membership', async () => {
    await expect(
      asUser(fixture.acme.users.member, (tx) =>
        createApiKey(tx, 'laptop', fixture.acme.members.admin),
      ),
    ).rejects.toThrow(/no membership/)

    const [row] = await owner<{ count: string }[]>`
      select count(*) from api_keys
    `
    expect(row!.count).toBe('0')
  })
})
