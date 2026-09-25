'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { DEMO_COOKIE } from '../../lib/demo'
import { siteFlags } from '../../lib/site-flags'
import { MEMBER_COOKIE } from '../../lib/viewer'

/** Leaves the demo (ticket 137): the only state it holds is its cookie and
 * the Org switcher's choice made inside it. */
export const exitDemo = async () => {
  const store = await cookies()
  store.delete(DEMO_COOKIE)
  store.delete(MEMBER_COOKIE)
  // Ticket 138: to the landing page, or to sign-in where there is none.
  redirect(siteFlags().landing ? '/' : '/sign-in')
}
