import { afterEach, describe, expect, it, vi } from 'vitest'

import { asksConsent } from '../app/(marketing)/clarity'
import robots from '../app/robots'

describe('robots', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('lets crawlers in only on the canonical site', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://sessclone.com')
    expect(robots().rules).toMatchObject({ allow: '/' })
    expect(robots().sitemap).toBe('https://sessclone.com/sitemap.xml')
  })

  it('keeps every other deployment out of search', () => {
    for (const url of [
      'https://sessclone.vercel.app',
      'https://self.example',
    ]) {
      vi.stubEnv('NEXT_PUBLIC_APP_URL', url)
      expect(robots()).toEqual({ rules: { userAgent: '*', disallow: '/' } })
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
    ]) {
      expect(asksConsent(zone), zone).toBe(true)
    }
  })

  it('does not ask elsewhere', () => {
    for (const zone of [
      'America/New_York',
      'Asia/Karachi',
      'Asia/Riyadh',
      'UTC',
    ]) {
      expect(asksConsent(zone), zone).toBe(false)
    }
  })
})
