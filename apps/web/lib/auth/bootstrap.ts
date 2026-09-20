import { randomUUID } from 'node:crypto'

import { asViewer } from '../db'

// Ticket 27: what happens the first time somebody signs in.
//
// Sign-in gives us a Supabase user; this gives that user somewhere to be. It
// runs on every sign-in rather than only on the first, because there is no
// reliable "first" — a magic link and a GitHub sign-in are two routes into the
// same account, an interrupted callback leaves a session with no Org, and a
// deployment that was restored from a backup has sessions older than its rows.
// So it is idempotent by construction: signing out and back in returns the
// same Org because the second call finds the membership the first one made.
//
// Every statement runs as the signing-in person, through `asViewer`, so the
// policies decide what is allowed. Nothing here uses the service role: this is
// a person acting on their own account, which is precisely what
// `users_create_self`, `orgs_create` and `members_invite`'s bootstrap branch
// were written for.

/** The name a brand-new Org gets, from the only thing we know about them. */
const orgNameFor = (email: string) => {
  const local = email.split('@')[0]?.trim()
  return local ? `${local}'s Org` : 'My Org'
}

export type SignedInOrg = { orgId: string; memberId: string }

/**
 * Makes sure the signer has a `users` row and a Member row somewhere, creating
 * an Org they own if they have none, and returns the Org they belong to.
 *
 * Returns the *first* Org when they belong to several. v1 has no Org switcher
 * (the product IA puts one Org per person), so "the Org they are in" is
 * unambiguous today; the ticket that adds a second Org is the one that has to
 * decide which is current.
 */
export const ensureOrgForSigner = async (
  userId: string,
  email: string,
): Promise<SignedInOrg> =>
  asViewer(userId, async (tx) => {
    // `on conflict do nothing` with no target rather than `(id)`: the row may
    // already exist under this id, and `users` also carries a unique index on
    // the lowercased email. Either collision means "this person is already
    // known", and neither is an error worth surfacing to somebody who has just
    // signed in successfully.
    await tx`
      insert into users (id, email) values (${userId}, ${email})
      on conflict do nothing
    `

    // What the policies let them see of themselves: their own live membership.
    // A removed Member reads nothing here — deliberately, per `members_read` —
    // so somebody removed from their only Org signs in and gets a new one,
    // which is the right answer: they are a new customer, not a returning
    // Member.
    const [existing] = await tx<{ org_id: string; id: string }[]>`
      select org_id, id from members
       where user_id = ${userId} and removed_at is null
       order by created_at
       limit 1
    `

    if (existing) {
      return { orgId: existing.org_id, memberId: existing.id }
    }

    // The ids are generated here rather than read back with `returning`.
    // `returning` applies the table's *select* policy to the new row, and
    // neither row can pass one: `orgs_read` wants a membership that the next
    // statement has not created yet, and `members_read` resolves through a
    // `stable` helper evaluated against a snapshot the new row is not in. Both
    // would fail the insert outright rather than merely withholding the value.
    const orgId = randomUUID()
    const memberId = randomUUID()

    await tx`insert into orgs (id, name) values (${orgId}, ${orgNameFor(email)})`

    // `members_invite`'s bootstrap branch: your own user id, the Owner role,
    // and only while the Org has no Members at all. The Org was created one
    // statement ago and has none, so this is the one insert it permits — and
    // it is why creating an Org does not leave something nobody can read.
    await tx`
      insert into members (id, org_id, user_id, role)
      values (${memberId}, ${orgId}, ${userId}, 'owner')
    `

    return { orgId, memberId }
  })
