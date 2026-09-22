import { describe, expect, it } from 'vitest'
import { readdir } from 'node:fs/promises'
// @ts-expect-error — a plain script, deliberately outside the TypeScript build.
import { missing } from '../scripts/schema-drift.mjs'

// The comparator behind `apps/web/scripts/schema-drift.mjs`. The script itself
// needs a deployment to talk to; this is the part that decides what counts as
// drift, and it is the part that was wrong-by-omission on 2026-09-22 — nothing
// compared the two sides at all.
describe('migrations the repository has and a database does not', () => {
  it('names a migration the database never ran', () => {
    expect(
      missing(
        ['20260920120000_accounts.sql', '20260922150000_friendly_names.sql'],
        ['20260920120000_accounts'],
      ),
    ).toEqual(['20260922150000_friendly_names'])
  })

  it('is empty when every file has been applied', () => {
    expect(
      missing(['20260920120000_accounts.sql'], ['20260920120000_accounts']),
    ).toEqual([])
  })

  // The ledger records when a migration ran, not what it is called, so the two
  // sides can only be compared on the name.
  it('ignores a migration the database has and the repository does not', () => {
    expect(missing(['a.sql'], ['a', 'b'])).toEqual([])
  })

  it('ignores anything that is not a migration', () => {
    expect(missing(['README.md', 'a.sql'], ['a'])).toEqual([])
  })

  // The escape itself: every file in `supabase/migrations` must be comparable
  // as a name, or the check silently passes on a database missing one.
  it('reads the repository’s own migrations', async () => {
    const files = await readdir(
      new URL('../../../supabase/migrations/', import.meta.url),
    )
    expect(missing(files, [])).toContain('20260922150000_friendly_names')
  })
})
