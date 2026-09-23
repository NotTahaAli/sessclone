import { beforeEach, expect, test } from 'vitest'

import { renderSignupNotice } from '../lib/mailer'
import { signupNotice } from '../lib/signup-notice'
import { asRole, owner as sql, seedFixture, type Fixture } from './harness'

// Ticket 120: who is told about a new sign-up, read as the person signing up
// on the unprivileged role, because the operators' addresses are exactly what
// `users_read` keeps from them otherwise.

let fixture: Fixture

beforeEach(async () => {
  fixture = await seedFixture()
})

const noticeAs = (role: Parameters<typeof asRole>[1]) =>
  asRole(fixture.acme, role, (tx) => signupNotice(tx, fixture.acme.id))

test('the Owner of an Org waiting for approval learns where to send it', async () => {
  const [tier] = await sql<{ id: string }[]>`
    insert into tiers (key, name) values ('team', 'Team') returning id
  `
  await sql`
    insert into subscriptions (org_id, tier_id, status, requested_seats)
    values (${fixture.acme.id}, ${tier!.id}, 'inactive', 3)
  `

  expect(await noticeAs('owner')).toEqual({
    to: ['operator@sessclone.test'],
    orgName: 'Acme',
    ownerEmail: 'owner@acme.test',
    tierName: 'Team',
    requestedSeats: 3,
  })
})

test('nobody else, and not once the Org is approved', async () => {
  // An Admin of the same Org is not the one signing up.
  expect((await noticeAs('admin'))?.to).toEqual([])

  const [tier] = await sql<{ id: string }[]>`
    insert into tiers (key, name) values ('team', 'Team') returning id
  `
  await sql`
    insert into subscriptions (org_id, tier_id, status)
    values (${fixture.acme.id}, ${tier!.id}, 'active')
  `
  expect((await noticeAs('owner'))?.to).toEqual([])
})

test('the notice escapes what the sign-up typed', () => {
  const message = renderSignupNotice({
    to: ['operator@sessclone.test'],
    orgName: '<script>Acme</script>',
    ownerEmail: 'owner@acme.test',
    tierName: 'Team',
    requestedSeats: 3,
    link: 'https://sessclone.test/admin/orgs/1',
  })
  expect(message.html).not.toContain('<script>')
  expect(message.text).toContain('(Team, 3 seats)')
  expect(message.text).toContain('https://sessclone.test/admin/orgs/1')
})
