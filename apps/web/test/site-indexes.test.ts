import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Ticket 138: the indexes a crawler or an assistant reads, under the flags.
// Nothing in them may point at a page this deployment 404s or redirects away
// from. The docs tree is stubbed: `lib/docs.ts` is a build-time macro, and the
// question is which pages are listed, not how MDX compiles.

vi.mock('../lib/docs', () => ({
  source: {
    getPages: () => [
      {
        url: '/docs',
        data: {
          title: 'Docs',
          description: 'Start here',
          getText: async () =>
            'Intro body\n\n## Install [#install]\n\nSee [it](/docs/install) &#x60;x&#x60;.\n\n<Card href="/docs/api" />\n',
        },
      },
      {
        url: '/docs/self-hosting',
        data: { title: 'Self-hosting', getText: async () => 'Clone it.' },
      },
    ],
  },
}))

// The indexes must follow the runtime flags rather than a build's, so each
// waits for a request (`connection()`) before it reads them. Counted here;
// the build's route table shows the same thing as ƒ rather than ○.
const connection = vi.fn(async () => {})
vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  connection,
}))

const { default: sitemap } = await import('../app/sitemap')
const { GET: llms } = await import('../app/llms.txt/route')
const { GET: llmsFull } = await import('../app/llms-full.txt/route')

const flags = (landing: boolean, docs: boolean) => {
  vi.stubEnv('ENABLE_LANDING', String(landing))
  vi.stubEnv('ENABLE_DOCS', String(docs))
}

beforeEach(() => {
  connection.mockClear()
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://self.example')
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('sitemap', () => {
  it('is rendered per request', async () => {
    await sitemap()
    expect(connection).toHaveBeenCalledOnce()
  })

  it('lists the whole site with every flag on', async () => {
    flags(true, true)
    expect((await sitemap()).map((entry) => entry.url)).toEqual([
      'https://self.example',
      'https://self.example/pricing',
      'https://self.example/privacy',
      'https://self.example/terms',
      'https://self.example/docs',
      'https://self.example/docs/self-hosting',
    ])
  })

  it('lists only the legal pages on a dashboard-only deployment', async () => {
    flags(false, false)
    expect((await sitemap()).map((entry) => entry.url)).toEqual([
      'https://self.example/privacy',
      'https://self.example/terms',
    ])
  })
})

describe('llms.txt', () => {
  it('is rendered per request', async () => {
    await llms()
    expect(connection).toHaveBeenCalledOnce()
  })

  it('links this deployment’s docs and pricing when it serves them', async () => {
    flags(true, true)
    const body = await (await llms()).text()
    expect(body).toContain('- [Docs](https://self.example/docs): Start here')
    expect(body).toContain('https://self.example/docs/self-hosting')
    expect(body).toContain('- [Pricing](https://self.example/pricing)')
    expect(body).toContain('https://self.example/llms-full.txt')
  })

  it('links the hosted docs, and no pricing, when it serves neither', async () => {
    flags(false, false)
    const body = await (await llms()).text()
    expect(body).toContain('- [Docs](https://sessclone.com/docs): Start here')
    expect(body).toContain('https://sessclone.com/docs/self-hosting')
    expect(body).not.toContain('self.example/docs')
    expect(body).not.toContain('Pricing')
  })
})

describe('llms-full.txt', () => {
  it('is rendered per request', async () => {
    await llmsFull()
    expect(connection).toHaveBeenCalledOnce()
  })

  it('carries every docs page whole, each with its source link', async () => {
    flags(true, true)
    const body = await (await llmsFull()).text()
    expect(body).toContain(
      '# Docs\n\nSource: https://self.example/docs\n\n> Start here\n\nIntro body\n\n## Install\n\nSee [it](https://self.example/docs/install) `x`.\n\n<Card href="https://self.example/docs/api" />\n',
    )
    expect(body).toContain(
      '# Self-hosting\n\nSource: https://self.example/docs/self-hosting\n\nClone it.\n',
    )
  })

  it('links the hosted docs when this deployment serves none', async () => {
    flags(false, false)
    const body = await (await llmsFull()).text()
    expect(body).toContain('Source: https://sessclone.com/docs/self-hosting')
    expect(body).toContain('See [it](https://sessclone.com/docs/install)')
    expect(body).not.toContain('self.example/docs')
  })
})
