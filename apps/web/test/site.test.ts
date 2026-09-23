import { readdirSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { asksConsent } from '../app/(marketing)/clarity'
import robots from '../app/robots'

describe('robots', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('lets crawlers in when SEARCH_INDEXING is on', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://sessclone.com')
    vi.stubEnv('SEARCH_INDEXING', 'on')
    expect(robots().rules).toMatchObject({ allow: '/' })
    expect(robots().sitemap).toBe('https://sessclone.com/sitemap.xml')
  })

  it('closes every signed-in route to crawlers', () => {
    vi.stubEnv('SEARCH_INDEXING', 'on')
    const rules = robots().rules
    const disallowed = Array.isArray(rules) ? [] : [rules.disallow].flat()
    const routes = readdirSync(new URL('../app/(dashboard)', import.meta.url), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `/${entry.name}`)
    for (const route of [...routes, '/admin']) {
      expect(disallowed, route).toContain(route)
    }
  })

  it('keeps a deployment out of search unless it opts in', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://sessclone.com')
    for (const value of [undefined, '', 'true', 'off']) {
      vi.stubEnv('SEARCH_INDEXING', value)
      expect(robots(), String(value)).toEqual({
        rules: { userAgent: '*', disallow: '/' },
      })
    }
  })
})

describe('asksConsent', () => {
  it('asks in the EEA, the UK and Switzerland', () => {
    for (const zone of [
      'Europe/Berlin',
      'Europe/London',
      'Europe/Zurich',
      'Atlantic/Reykjavik',
      'Atlantic/Canary',
      'Asia/Nicosia',
      'Africa/Ceuta',
      'America/Martinique',
      'Indian/Reunion',
      // No usable zone: a privacy-hardened browser reports UTC. Ask.
      'UTC',
      'Etc/UTC',
      '',
    ]) {
      expect(asksConsent(zone), zone).toBe(true)
    }
  })

  it('does not ask elsewhere', () => {
    for (const zone of ['America/New_York', 'Asia/Karachi', 'Asia/Riyadh']) {
      expect(asksConsent(zone), zone).toBe(false)
    }
  })
})
