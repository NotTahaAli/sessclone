import { expect, test, vi } from 'vitest'

import { securityTxt } from '../lib/security-txt'

const field = (body: string, name: string) =>
  body
    .split('\n')
    .filter((line) => line.startsWith(`${name}: `))
    .map((line) => line.slice(name.length + 2))

test('Expires is a year after the request, so the file never lapses', () => {
  const body = securityTxt(new Date('2026-09-25T07:00:00Z'), null)
  expect(field(body, 'Expires')).toEqual(['2027-09-25T07:00:00.000Z'])
})

test('private advisories always, the operator address only when set', () => {
  expect(field(securityTxt(new Date(), null), 'Contact')).toEqual([
    'https://github.com/NotTahaAli/sessclone/security/advisories/new',
  ])
  expect(
    field(securityTxt(new Date(), 'hello@example.com'), 'Contact'),
  ).toEqual([
    'https://github.com/NotTahaAli/sessclone/security/advisories/new',
    'mailto:hello@example.com',
  ])
})

test('Canonical only for an https deployment, never the localhost fallback', () => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', undefined)
  expect(field(securityTxt(new Date(), null), 'Canonical')).toEqual([])
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://sessclone.com')
  expect(field(securityTxt(new Date(), null), 'Canonical')).toEqual([
    'https://sessclone.com/.well-known/security.txt',
  ])
  vi.unstubAllEnvs()
})
