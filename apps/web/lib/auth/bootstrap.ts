import { randomUUID } from 'node:crypto'

import type { TransactionSql } from 'postgres'

import { approvalRequired } from '../approval'
import { asViewer } from '../db'
import { requestPlan, type SignupPlan } from '../subscriptions'

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

/** Postgres' `unique_violation`. Here, `users_email_key` and nothing else. */
const UNIQUE_VIOLATION = '23505'

export type SignedInOrg = {
  orgId: string
  memberId: string
  /** True when this sign-in made the Org: a new signup (ticket 120 mails the
   * operator about it). */
  created: boolean
}

export type SignInOptions = {
  /** The plan the sign-up asked for (ticket 118), written as an `inactive`
   * subscription row when — and only when — this sign-in creates the Org. */
  plan?: SignupPlan | null
  /**
   * False for a sign-in on its way to accept an invitation. An Org of their
   * own would be pending approval (ticket 119) and, being older than the
   * membership they are about to accept, the one the dashboard opens first —
   * locking them out of the Org that invited them. If they never accept, the
   * next ordinary sign-in creates one.
   */
  createOrg?: boolean
}

/**
 * Thrown when the signer's email already belongs to a different account.
 *
 * Not a crash and not something to paper over: two ids for one address means
 * two accounts, and picking either one silently is how somebody ends up in
 * somebody else's Org. The callback turns this into a refused sign-in.
 */
export class EmailBelongsToAnotherAccount extends Error {
  constructor(email: string) {
    super(`${email} is already signed up under a different identity`)
    this.name = 'EmailBelongsToAnotherAccount'
  }
}

/**
 * Makes sure the signer has a `users` row and a Member row somewhere, creating
 * an Org they own if they have none, and returns the Org they belong to.
 *
 * Returns the *oldest* Org when they belong to several. Which one the
 * dashboard opens is `sessionViewer`'s to decide (the Org switcher's choice on
 * this device, then an Org that works, then the oldest); this is only proof
 * that there is somewhere to be.
 */
export const ensureOrgForSigner = async (
  userId: string,
  email: string,
  { plan = null, createOrg = true }: SignInOptions = {},
): Promise<SignedInOrg | null> =>
  asViewer(userId, async (tx) => {
    // `on conflict (id)` and not a bare `on conflict`. A collision on the id is
    // this person signing in again, which is the idempotent case. A collision
    // on `users_email_key` is a *different* account holding that address, and
    // swallowing it leaves no `users` row for this id — the Member insert
    // below then failed on `members_user_id_fkey`, after the session cookie
    // had already been written, so the person was signed in, had no Org, and
    // every later sign-in failed the same way. It is reachable: a Supabase
    // project that does not link a GitHub identity to an existing magic-link
    // account issues a second id for one address, and ticket 49's invite
    // creates a `users` row before the invitee has ever signed in.
    //
    // Two accounts for one address is not something to resolve by guessing, so
    // it is raised as itself and the callback refuses the sign-in.
    try {
      await tx`
        insert into users (id, email) values (${userId}, ${email})
        on conflict (id) do nothing
      `
    } catch (cause) {
      if (
        cause instanceof Error &&
        'code' in cause &&
        cause.code === UNIQUE_VIOLATION
      ) {
        throw new EmailBelongsToAnotherAccount(email)
      }
      throw cause
    }

    // What the policies let them see of themselves: their own live membership.
    // A removed Member reads nothing here — deliberately, per `members_read` —
    // so somebody removed from their only Org signs in and gets a new one,
    // which is the right answer: they are a new customer, not a returning
    // Member.
    //
    // Under the person's own lock (`createOwnOrg`), so a New Org submitted
    // while this decides cannot make a second Org beside the one it makes.
    await lockOwnOrgs(tx, userId)
    const [existing] = await tx<{ org_id: string; id: string }[]>`
      select org_id, id from members
       where user_id = ${userId} and removed_at is null
       order by created_at
       limit 1
    `

    if (existing) {
      return { orgId: existing.org_id, memberId: existing.id, created: false }
    }

    if (!createOrg) return null

    const made = await foundOrg(tx, userId, { name: orgNameFor(email), plan })
    return { ...made, created: true }
  })

/** An Org to make: its name, and the plan it asks for (null: none). */
export type NewOrg = { name: string; plan: SignupPlan | null }

/**
 * Makes an Org with `userId` as its Owner, and asks for its plan. The one
 * way an Org comes to exist, for sign-in and for "New Org" (ticket 136).
 */
const foundOrg = async (
  tx: TransactionSql,
  userId: string,
  { name, plan }: NewOrg,
): Promise<{ orgId: string; memberId: string }> => {
  // The ids are generated here rather than read back with `returning`.
  // `returning` applies the table's *select* policy to the new row, and
  // neither row can pass one: `orgs_read` wants a membership that the next
  // statement has not created yet, and `members_read` resolves through a
  // `stable` helper evaluated against a snapshot the new row is not in. Both
  // would fail the insert outright rather than merely withholding the value.
  const orgId = randomUUID()
  const memberId = randomUUID()

  await tx`insert into orgs (id, name) values (${orgId}, ${name})`

  // `members_invite`'s bootstrap branch: your own user id, the Owner role,
  // and only while the Org has no Members at all. The Org was created one
  // statement ago and has none, so this is the one insert it permits — and
  // it is why creating an Org does not leave something nobody can read.
  await tx`
    insert into members (id, org_id, user_id, role)
    values (${memberId}, ${orgId}, ${userId}, 'owner')
  `

  // Ticket 118: the plan they asked for, as the row the operator confirms.
  // Absent (an old link, a hand-typed callback URL) leaves no row, which
  // the Admin panel lists as pending just the same (ticket 120).
  // In a savepoint, and a refusal swallowed: a size the Tier does not allow
  // is an ask the operator settles, not a sign-in (or a New Org) that fails. The Org still
  // exists and still waits; it simply waits with no plan on it.
  // Not at all with approval switched off: nobody would ever confirm it.
  if (plan && approvalRequired()) {
    await tx
      .savepoint((sp) => requestPlan(sp, { orgId, ...plan }))
      .catch((cause: unknown) => {
        console.error('the requested plan was refused', cause)
      })
  }

  return { orgId, memberId }
}

/** Thrown when the person already owns an Org waiting for approval. */
export class PendingOrgExists extends Error {
  constructor() {
    super('an Org of yours is already waiting for approval')
    this.name = 'PendingOrgExists'
  }
}

/**
 * "New Org" in the Org switcher (ticket 136, Taha's picks): any number of
 * approved Orgs, but at most one the person owns that is waiting for approval
 * — `inactive` or no subscription row, as the Admin panel counts waiting
 * (`pendingOrgCount`). Cancelled does not count. With approval off nothing
 * waits, so nothing is limited.
 *
 * The person's own advisory lock is taken before the check, so two submits at
 * once run one after the other and the second sees the first's Org (its next
 * statement reads a fresh snapshot under read committed). Sign-in takes the
 * same lock before it decides to create one.
 */
export const createOwnOrg = async (
  tx: TransactionSql,
  userId: string,
  org: NewOrg,
): Promise<{ orgId: string; memberId: string }> => {
  await lockOwnOrgs(tx, userId)
  if (approvalRequired()) {
    const [waiting] = await tx`
      select 1 from members member
        left join subscriptions subscription
               on subscription.org_id = member.org_id
       where member.id in (select sessclone_own_member_ids())
         and member.role = 'owner'
         and (subscription.status is null or subscription.status = 'inactive')
       limit 1
    `
    if (waiting) throw new PendingOrgExists()
  }
  return foundOrg(tx, userId, org)
}

/** Serialises Org creation per person, until the transaction ends. */
const lockOwnOrgs = (tx: TransactionSql, userId: string) =>
  tx`select pg_advisory_xact_lock(hashtextextended(${`new-org:${userId}`}, 0))`
