import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Ticket 138, rendered: the links the flags decide, as the pages draw them.
// `lib/site-flags.ts` decides; these prove the pages ask it. The session is
// stubbed, since the question is which link a visitor is shown.

let user: { id: string; email: string } | null = null
vi.mock('../lib/supabase/server', () => ({
  sessionUser: async () => user,
  realSessionUser: async () => user,
}))

const { default: MarketingLayout } = await import('../app/(marketing)/layout')
const { SignedInResolved } = await import('../app/(marketing)/signed-in-link')
const { DemoLink, DemoLinkResolved } =
  await import('../app/(marketing)/demo-link')
const { HomeLogo } = await import('../app/(dashboard)/home-logo')

afterEach(() => {
  user = null
  vi.unstubAllEnvs()
})

const flags = (landing: boolean, docs: boolean, demo = false) => {
  vi.stubEnv('ENABLE_LANDING', String(landing))
  vi.stubEnv('ENABLE_DOCS', String(docs))
  vi.stubEnv('ENABLE_DEMO', String(demo))
}

/** Every link's href and text, in order. */
const links = (html: string) =>
  [...html.matchAll(/<a [^>]*href="([^"]*)"[^>]*>([^<]*)</g)].map(
    ([, href, text]) => `${text} ${href}`,
  )

describe('the marketing header and footer', () => {
  it.each([
    [true, true, ['Pricing /pricing', 'Docs /docs']],
    [true, false, ['Pricing /pricing', 'Docs https://sessclone.com/docs']],
    [false, true, ['Docs /docs']],
    [false, false, ['Docs https://sessclone.com/docs']],
  ])('landing %s, docs %s', (landing, docs, expected) => {
    flags(landing, docs)
    const html = renderToStaticMarkup(<MarketingLayout>page</MarketingLayout>)
    const [header, footer] = html.split('<footer')
    const nav = (part: string) =>
      links(part).filter((link) => /^(Pricing|Docs) /.test(link))
    expect(nav(header!)).toEqual(expected)
    expect(nav(footer!)).toEqual(expected)
  })

  it('holds the account button’s place without saying Sign in first', () => {
    flags(true, true)
    const html = renderToStaticMarkup(<MarketingLayout>page</MarketingLayout>)
    const header = html.split('<footer')[0]!
    // The prerendered shell: a signed-in reader saw "Sign in" flash here.
    expect(header).not.toContain('Sign in')
    // A pill of the button's width, holding its place with nothing in it.
    expect(header).toMatch(
      /<span aria-hidden="true" class="[^"]*min-w-[^"]*"><span class="invisible">Dashboard<\/span><\/span>/,
    )
  })
})

describe('the header’s account button, resolved', () => {
  it('is Sign in for a visitor, Dashboard for a signed-in person', async () => {
    expect(
      links(
        renderToStaticMarkup(await SignedInResolved({ variant: 'header' })),
      ),
    ).toEqual(['Sign in /sign-in'])

    user = { id: 'user-1', email: 'a@example.test' }
    expect(
      links(
        renderToStaticMarkup(await SignedInResolved({ variant: 'header' })),
      ),
    ).toEqual(['Dashboard /costs'])
  })
})

describe('the dashboard logo', () => {
  it.each([
    [true, '/', 'SessClone home page'],
    [false, '/costs', 'Dashboard home'],
  ])('landing %s links to %s', (landing, href, label) => {
    flags(landing, false)
    const html = renderToStaticMarkup(<HomeLogo />)
    expect(html).toContain(`href="${href}"`)
    expect(html).toContain(`aria-label="${label}"`)
  })
})

describe('Try the demo', () => {
  it('is there only where the demo runs', async () => {
    flags(true, true, false)
    expect(renderToStaticMarkup(<DemoLink />)).toBe('')
    flags(true, true, true)
    expect(links(renderToStaticMarkup(await DemoLinkResolved({})))).toEqual([
      'Try the demo /demo',
    ])
  })

  it('is not in the shell before the session is read', () => {
    flags(true, true, true)
    expect(renderToStaticMarkup(<DemoLink />)).not.toContain('/demo')
  })

  it('is hidden from someone signed in, whose session wins over the demo', async () => {
    flags(true, true, true)
    expect(links(renderToStaticMarkup(await DemoLinkResolved({})))).toEqual([
      'Try the demo /demo',
    ])
    user = { id: 'user-1', email: 'a@example.test' }
    expect(renderToStaticMarkup(await DemoLinkResolved({ block: true }))).toBe(
      '',
    )
  })
})
