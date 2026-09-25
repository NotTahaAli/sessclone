import { expect, test, type Page } from '@playwright/test'

// Ticket 135: the Org switcher's two ways into another Org. The seed is
// `global-setup.ts`: the person owns Alpha, which is approved, and Bravo has
// invited them.

const openSwitcher = async (page: Page) => {
  await page.goto('/costs')
  await page.getByRole('button', { name: /switch Org/ }).click()
  return page.getByRole('dialog', { name: 'Orgs and invites' })
}

test('accepting an invitation from the switcher lands in that Org', async ({
  page,
}) => {
  const switcher = await openSwitcher(page)
  await switcher.getByRole('button', { name: 'Accept' }).click()

  await expect(page).toHaveURL(/\/costs$/)
  await expect(
    page.getByRole('button', { name: /^Bravo: switch Org/ }),
  ).toBeVisible()
})

test('a New Org from the switcher lands on its waiting page', async ({
  page,
}) => {
  const switcher = await openSwitcher(page)
  await switcher.getByRole('link', { name: 'New Org' }).click()

  await expect(page).toHaveURL(/\/new-org$/)
  await page.getByRole('textbox', { name: 'Name' }).fill('Charlie')
  await page.getByRole('button', { name: 'Create Org' }).click()

  await expect(
    page.getByRole('heading', { name: 'You’re on the waitlist' }),
  ).toBeVisible()
  await expect(page.getByText(/^Charlie is on the waitlist/)).toBeVisible()
})
