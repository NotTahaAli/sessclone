import type { TransactionSql } from 'postgres'

import { appUrl } from './auth/app-url'
import { asViewer } from './db'
import {
  mailerConfigured,
  sendSignupNotice,
  type Delivery,
  type SignupNotice,
} from './mailer'

// Ticket 120: an email to the platform admins when somebody signs up, so an
// Org waiting for approval (ticket 119) is not waiting on somebody who does
// not know it exists.
//
// Gated on SMTP (`SMTP_URL` and `SMTP_FROM`, `lib/mailer.ts`) and nothing
// else: unset, nothing is read and nothing is sent, and the Admin panel's
// pending list and count are how the operator finds out instead. Taha has not
// decided more than "email once SMTP exists", so there is no separate switch.

/**
 * Everything the notice says, read as the person who just signed up — their
 * own Org, their own subscription row, their own address — plus the
 * operators' addresses from `sessclone_signup_notice_recipients`, which
 * answers only the Owner of an Org still waiting for approval.
 */
export const signupNotice = async (
  tx: TransactionSql,
  orgId: string,
): Promise<Omit<SignupNotice, 'link'> | null> => {
  const [row] = await tx<
    {
      org_name: string
      owner_email: string
      tier_name: string | null
      requested_seats: number | null
      recipients: string[]
    }[]
  >`
    select org.name as org_name,
           owner.email as owner_email,
           tier.name as tier_name,
           subscription.requested_seats,
           array(select sessclone_signup_notice_recipients(org.id))
             as recipients
      from orgs org
      join users owner on owner.id = sessclone_user_id()
      left join subscriptions subscription on subscription.org_id = org.id
      left join tiers tier on tier.id = subscription.tier_id
     where org.id = ${orgId}
  `
  if (!row) return null

  return {
    to: row.recipients,
    orgName: row.org_name,
    ownerEmail: row.owner_email,
    tierName: row.tier_name,
    requestedSeats: row.requested_seats,
  }
}

/** Sends the notice for a just-created Org. Never throws: the sign-up has
 * already happened, and this runs after the response (`after()`). */
export const notifySignup = async (
  userId: string,
  orgId: string,
): Promise<Delivery> => {
  if (!mailerConfigured()) return 'not-configured'
  try {
    const notice = await asViewer(userId, (tx) => signupNotice(tx, orgId))
    if (!notice) return 'failed'
    return await sendSignupNotice({
      ...notice,
      link: `${appUrl()}/admin/orgs/${orgId}`,
    })
  } catch (cause) {
    console.error('sign-up: the notice to the operators failed', cause)
    return 'failed'
  }
}
