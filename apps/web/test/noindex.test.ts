import { describe, expect, it, vi } from 'vitest'

// Pages a signed-out visitor or a crawler can reach that must never be a
// search result. Each module is mocked down to its metadata: the question is
// what it exports, not how it renders.
vi.mock('server-only', () => ({}))

const pages = {
  '/sign-in': () => import('../app/sign-in/page'),
  '/sign-up': () => import('../app/sign-up/page'),
  '/join': () => import('../app/join/[token]/page'),
  '/new-org': () => import('../app/new-org/page'),
  '/admin': () => import('../app/admin/layout'),
}

describe('noindex', () => {
  for (const [route, load] of Object.entries(pages)) {
    it(`${route} is kept out of search with its own title`, async () => {
      const { metadata } = await load()
      expect(metadata.robots).toMatchObject({ index: false })
      expect(metadata.title).toEqual(expect.any(String))
    })
  }
})
