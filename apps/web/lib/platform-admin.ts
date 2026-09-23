import type { TransactionSql } from 'postgres'
import { cache } from 'react'

import { asViewer } from './db'
import { signedInUser } from './supabase/server'

// Ticket 62: who reaches the operator's area, answered once per request.
//
// Platform Admin is not a Role inside any Org. `CONTEXT.md` is explicit that
// it is the operator of a deployment, governing the deployment rather than one
// Org, so this deliberately does not go through `currentViewer` — an operator
// may belong to no Org at all, and the most senior Role in an Org grants
// nothing here.
//
// The answer comes from `sessclone_is_platform_admin()`, which is the same
// function every policy on `rates`, `tiers` and `subscriptions` asks. That is
// the point: the routing gate and the policy gate are not two rules that have
// to be kept in agreement, they are one rule read twice. A page that forgot
// this check would still be refused every row it tried to read, and a policy
// that changed would change what the navigation offers in the same commit.

export type Operator = {
  userId: string
  email: string
  /** Their display name (ticket 91), which the admin frame leads with. */
  name: string | null
}

/**
 * The signed-in platform administrator, or `null` for everybody else —
 * including a signed-in Org Owner, which is the refusal ticket 62 names.
 *
 * `cache` for the same reason `currentViewer` has it: the admin layout and the
 * page it wraps both call this while rendering one request, and without it
 * that is two `signedInUser()` round trips and two transactions for one
 * navigation.
 */
export const currentOperator = cache(async (): Promise<Operator | null> => {
  const user = await signedInUser()
  if (!user) return null

  const [row] = await asViewer(
    user.id,
    (tx) =>
      tx<{ admin: boolean; name: string | null }[]>`
        select sessclone_is_platform_admin() as admin,
               (select display_name from users where id = ${user.id}) as name
      `,
  )

  return row?.admin
    ? { userId: user.id, email: user.email, name: row.name }
    : null
})

/**
 * Runs `query` as the signed-in operator.
 *
 * An admin page needs an identity to open a transaction with, which is not the
 * same thing as a gate: the gate is the layout's, and `rates_write` refuses
 * every statement independently. This exists so a page can get the identity
 * without writing `currentOperator()` next to its own `notFound()` — the rule
 * ticket 62 set, and the one `test/navigation.test.ts` enforces.
 */
export const asOperator = async <T>(
  query: (tx: TransactionSql) => Promise<T>,
) => {
  const operator = await currentOperator()
  if (!operator) throw new Error('not a platform administrator')
  return asViewer(operator.userId, query)
}
