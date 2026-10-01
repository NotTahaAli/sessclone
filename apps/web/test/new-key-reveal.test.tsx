import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'

import { installCommand, MARKETPLACE_COMMAND } from '../lib/install-command'

// Ticket 148: the one render that has the key is the whole setup, in order.
// It used to offer the install command alone and point at "step 1 below",
// past the key list, so a first-time reader on a phone ran step 2 first.

vi.mock('../app/(dashboard)/keys/actions', () => ({ createKey: () => null }))

const { Revealed } = await import('../app/(dashboard)/keys/new-key-form')

test('the new key comes with every step, marketplace first', () => {
  const html = renderToStaticMarkup(
    <Revealed apiKey="sk_test_123" appUrl="https://sessclone.com" />,
  )
  const marketplace = html.indexOf(MARKETPLACE_COMMAND)
  const install = html.indexOf(
    installCommand('https://sessclone.com', 'sk_test_123'),
  )
  const restart = html.indexOf('Restart Claude Code')

  expect(marketplace).toBeGreaterThan(-1)
  expect(install).toBeGreaterThan(marketplace)
  expect(restart).toBeGreaterThan(install)
  expect(html).not.toContain('step 1 below')
})
