import { expect, test } from '@playwright/test'

// Ticket 138: `/` for a signed-in person, with the landing page on
// (`playwright.config.ts`). Typed, it opens the dashboard; reached by the
// dashboard's logo, it is the landing page and stays there. The decision is
// the Proxy's, and which browser header it reads is what only a browser can
// prove.

test('a typed / opens the dashboard; the logo reaches the landing page', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/costs$/)

  await page
    .getByRole('link', { name: 'SessClone home page' })
    .locator('visible=true')
    .click()

  await expect(page).toHaveURL(/\/$/)
  await expect(
    page.getByRole('heading', { name: /Count it as one/ }),
  ).toBeVisible()
  // Signed in, the header offers the dashboard rather than sign-in.
  await expect(
    page.getByRole('banner').getByRole('link', { name: 'Dashboard' }),
  ).toBeVisible()

  // No bounce afterwards, and none on a reload of the page either.
  await page.waitForTimeout(500)
  await expect(page).toHaveURL(/\/$/)
  await page.reload()
  await expect(page).toHaveURL(/\/$/)
})
