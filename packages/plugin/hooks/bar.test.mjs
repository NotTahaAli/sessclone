import { expect, test } from 'vitest'

import { barParts, dotColor, optionEnvironment, sessionLink } from './bar.ts'

const standing = (overrides = {}) => ({
  url: 'https://sessclone.com',
  connection: 'connected',
  org: 'Acme',
  checkedAt: null,
  oldNode: false,
  queued: 0,
  unsent: 0,
  lastPush: null,
  sessionId: 'session-1',
  ...overrides,
})

test('a caught-up session reads connected and synced, in green', () => {
  expect(barParts(standing())).toEqual(['connected · Acme', 'session synced'])
  expect(dotColor(standing())).toBe('success')
})

test('Turns behind and queued payloads are counted, in yellow', () => {
  const behind = standing({ unsent: 1, queued: 3 })
  expect(barParts(behind)).toEqual([
    'connected · Acme',
    '1 Turn behind',
    '3 queued',
  ])
  expect(dotColor(behind)).toBe('warning')
})

test('a refused key and an old Node are red, and say so first', () => {
  expect(barParts(standing({ connection: 'refused' }))[0]).toBe('key refused')
  expect(dotColor(standing({ connection: 'refused' }))).toBe('error')
  expect(barParts(standing({ oldNode: true, unsent: null }))).toEqual([
    'needs Node 22.18+',
  ])
})

test('the link is the session page, only where a surface may draw it', () => {
  expect(sessionLink('https://sessclone.com', 'a b')).toBe(
    'https://sessclone.com/sessions/a%20b',
  )
  expect(sessionLink('http://localhost:3000', 's')).toBe(
    'http://localhost:3000/sessions/s',
  )
  // A Link to anything else refuses the whole bar.
  expect(sessionLink('http://intranet.example', 's')).toBeNull()
  expect(sessionLink(null, 's')).toBeNull()
})

test('only the answers given are handed on, under the hook names', () => {
  expect(optionEnvironment({ url: '', api_key: 'sk_x', flag: true })).toEqual({
    CLAUDE_PLUGIN_OPTION_API_KEY: 'sk_x',
  })
})
