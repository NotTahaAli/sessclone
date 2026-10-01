import { beforeEach, afterEach, expect, test, vi } from 'vitest'

// Ticket 146: approving an Org from the Admin page emails its Owners — after
// the response, once, and never with approval off. `test/signup-notice.test.ts`
// covers who is addressed and what it says; this covers only that
// `activateAction` triggers it on the save that lets the Org in.

const signedInUser = vi.hoisted(() => vi.fn())
vi.mock('../lib/supabase/server', () => ({
  signedInUser,
  sessionUser: signedInUser,
  accountUser: signedInUser,
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('../lib/db', async () => {
  const harness = await import('./harness')
  return { asViewer: harness.asUser }
})

const afterCallbacks: Array<() => unknown> = []
vi.mock('next/server', () => ({
  after: (callback: () => unknown) => {
    afterCallbacks.push(callback)
  },
}))

const notifyApproval = vi.fn(
  async (_operatorId: string, _orgId: string) => 'not-configured' as const,
)
vi.mock('../lib/signup-notice', () => ({ notifyApproval }))

const { seedFixture, owner: sql } = await import('./harness')

let fixture: Awaited<ReturnType<typeof seedFixture>>
let tierId: string

beforeEach(async () => {
  afterCallbacks.length = 0
  notifyApproval.mockClear()
  fixture = await seedFixture()
  const [tier] = await sql<{ id: string }[]>`
    insert into tiers (key, name) values ('personal', 'Personal') returning id
  `
  tierId = tier!.id
  signedInUser.mockResolvedValue({
    id: fixture.platformAdmin.userId,
    email: 'operator@sessclone.test',
  })
})

afterEach(() => vi.unstubAllEnvs())

const activate = async (status: string) => {
  const { activateAction } = await import('../app/admin/orgs/[orgId]/actions')
  const data = new FormData()
  data.set('orgId', fixture.acme.id)
  data.set('tierId', tierId)
  data.set('status', status)
  const result = await activateAction(null, data)
  const queued = afterCallbacks.splice(0)
  await Promise.all(queued.map((callback) => callback()))
  return result
}

test('approving a waiting Org tells its Owners once, after the response', async () => {
  vi.stubEnv('SIGNUP_APPROVAL', 'on')

  expect(await activate('inactive')).toEqual({ saved: 'recorded' })
  expect(notifyApproval).not.toHaveBeenCalled()

  expect(await activate('active')).toEqual({ saved: 'recorded' })
  expect(notifyApproval).toHaveBeenCalledTimes(1)
  expect(notifyApproval).toHaveBeenCalledWith(
    fixture.platformAdmin.userId,
    fixture.acme.id,
  )

  // Saving it again, or moving it between open statuses, is not news.
  await activate('active')
  await activate('past_due')
  expect(notifyApproval).toHaveBeenCalledTimes(1)
})

test('approval off: nobody was waiting, so nobody is told', async () => {
  vi.stubEnv('SIGNUP_APPROVAL', 'off')
  expect(await activate('active')).toEqual({ saved: 'recorded' })
  expect(notifyApproval).not.toHaveBeenCalled()
})
