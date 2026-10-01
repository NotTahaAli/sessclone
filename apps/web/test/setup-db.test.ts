import { describe, expect, it } from 'vitest'
// @ts-expect-error — a plain script, deliberately outside the TypeScript build.
import { appRole, plan } from '../scripts/setup-db.mjs'

// The decisions behind `apps/web/scripts/setup-db.mjs`. The script itself needs
// a database; these are the parts that decide what it runs and as whom, and a
// wrong answer from either is a broken deployment rather than an error.
describe('which migrations setup applies', () => {
  const files = [
    'a_one.sql',
    'b_two.sql',
    'c_drop.sql',
    'd_four.sql',
    'README.md',
  ]
  const headers = {
    'c_drop.sql': '-- Ticket 1. RUN THIS AFTER THE DEPLOY THAT SHIPS IT',
  }

  it('applies everything to a fresh database, after-deploy files included', () => {
    expect(plan(files, [], headers)).toEqual({
      apply: ['a_one.sql', 'b_two.sql', 'c_drop.sql', 'd_four.sql'],
      held: null,
    })
  })

  // The live code still needs what that file removes, so an upgrade stops
  // there rather than skipping it and running the files after it.
  it('stops an upgrade at the first after-deploy file', () => {
    expect(plan(files, [{ version: 'a', name: 'a_one' }], headers)).toEqual({
      apply: ['b_two.sql'],
      held: 'c_drop.sql',
    })
  })

  it('runs the after-deploy file when told the deploy is done', () => {
    expect(
      plan(files, [{ version: 'a', name: 'a_one' }], headers, {
        afterDeploy: true,
      }),
    ).toEqual({ apply: ['b_two.sql', 'c_drop.sql', 'd_four.sql'], held: null })
  })

  // The Supabase CLI records the short name, a hand-applied row the stem;
  // either one means the file ran.
  it('counts a ledger row by version or by name', () => {
    expect(
      plan(
        files,
        [
          { version: 'a', name: 'one' },
          { version: 'x', name: 'b_two' },
        ],
        headers,
      ).apply,
    ).toEqual([])
  })

  it('applies nothing when the ledger is complete', () => {
    const all = ['a', 'b', 'c', 'd'].map((version) => ({ version, name: '' }))
    expect(plan(files, all, headers)).toEqual({ apply: [], held: null })
  })
})

describe('the role DATABASE_URL must name', () => {
  it('accepts sessclone_app, directly or through the pooler', () => {
    expect(appRole('postgres://sessclone_app:p%40ss@db:5432/x')).toBe('p@ss')
    expect(
      appRole('postgres://sessclone_app.abcd:pw@pooler:6543/postgres'),
    ).toBe('pw')
  })

  // The owner reads past every policy; this is the mistake with no error.
  it('refuses the owning role', () => {
    expect(() => appRole('postgres://sessclone:pw@db:5432/x')).toThrow(
      /not sessclone_app/,
    )
  })

  it('refuses a URL with no password to set', () => {
    expect(() => appRole('postgres://sessclone_app@db:5432/x')).toThrow(
      /no password/,
    )
  })
})
