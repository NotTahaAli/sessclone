'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { DEMO_COOKIE } from '../../lib/demo'
import { MEMBER_COOKIE } from '../../lib/viewer'

/** Leaves the demo (ticket 137): the only state it holds is its cookie and
 * the Org switcher's choice made inside it. */
export const exitDemo = async () => {
  const store = await cookies()
  store.delete(DEMO_COOKIE)
  store.delete(MEMBER_COOKIE)
  redirect('/')
}
