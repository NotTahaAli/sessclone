import { expect, test } from '@playwright/test'

import { INVITEE_STATE } from '../playwright.config'

// Ticket 161: two escapes from the Team walkthrough. The seed is
// `global-setup.ts`: the person owns Alpha, where teammate@alpha.test is a
// Member, and Alpha has invited invitee@sessclone.test, who is in no Org.

test('a saved Role stays on the Role picker', async ({ page }) => {
  await page.goto('/settings/org/members')
  const role = page.getByRole('combobox', {
    name: 'Role for teammate@alpha.test',
  })

  await role.selectOption('manager')
  await page.getByRole('button', { name: 'Save' }).click()

  // React resets a form once its action settles, which put the picker back
  // on the Role it was first drawn with while the row said the new one.
  await expect(
    page.getByRole('region', { name: "teammate@alpha.test's Scope" }),
  ).toBeVisible()
  await expect(role).toHaveValue('manager')
  await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0)
})

test.describe('somebody signed in with no Org', () => {
  test.use({ storageState: INVITEE_STATE })

  test('accepts their invitation from the page they land on', async ({
    page,
  }) => {
    await page.goto('/costs')
    await expect(
      page.getByRole('heading', { name: 'No Org yet' }),
    ).toBeVisible()

    await page.getByRole('button', { name: 'Accept' }).click()

    await expect(
      page.getByRole('button', { name: /^Alpha: switch Org/ }),
    ).toBeVisible()
  })
})
