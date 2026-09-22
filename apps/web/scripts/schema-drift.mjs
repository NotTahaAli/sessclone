// A deployment whose code is ahead of its schema.
//
// The failure this exists to catch, from 2026-09-22: PR #19 added
// `20260922150000_friendly_names.sql`, the deploy carried the pages that read
// `projects.nickname`, `session_labels` and `users.display_name`, and nobody
// applied the migration. Vercel runs no migrate step and never has — a
// migration reaches a deployment because a person applies it — so the schema
// and the code drift apart silently and the first report is a person on a
// broken page. Every page that read a new name failed with a bare 42703 while
// `/costs`, `/keys` and `/devices` carried on working, which is what made it
// look like four unrelated bugs rather than one missing file.
//
// Run it against a deployment's database after every deploy that adds a
// migration, with the same variable the application reads:
//
//   DATABASE_URL=… node apps/web/scripts/schema-drift.mjs
//
// It prints the migrations the repository has and the database does not, and
// exits non-zero when there are any. Nothing here is part of the test suite:
// it needs a deployment, and CI has its own database with every migration
// already applied to it.
//
// The ledger it reads is `supabase_migrations.schema_migrations`, which is
// written by the Supabase CLI and by the Management API. A self-hoster
// applying the files with `psql` has no such table; the script says so and
// stops rather than reporting every migration as missing.

import { readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

const MIGRATIONS = new URL('../../../supabase/migrations/', import.meta.url)

/**
 * The migrations the repository has and the database does not, in the order
 * they would be applied.
 *
 * Compared on the file's stem rather than on the ledger's own `version`: the
 * version column records *when* a migration was applied, not what it is
 * called, so two projects that ran the same file hold two different versions.
 * The name is the only thing both sides agree on.
 *
 * A migration the database has and the repository does not is not drift in
 * this direction and is not reported — that is a deployment carrying an older
 * checkout, which is the deployer's business, not a broken page.
 */
export const missing = (files, applied) => {
  const have = new Set(applied)
  return files
    .filter((f) => f.endsWith('.sql'))
    .map((f) => f.replace(/\.sql$/, ''))
    .filter((name) => !have.has(name))
    .toSorted()
}

const main = async () => {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')

  // `prepare: false` for the same reason `apps/web/lib/db.ts` sets it: a
  // transaction-mode pooler hands the next statement to another backend.
  const sql = postgres(url, { prepare: false })
  try {
    const [ledger] = await sql`
      select to_regclass('supabase_migrations.schema_migrations') is not null as present
    `
    if (!ledger.present) {
      console.error(
        'no supabase_migrations.schema_migrations in this database — ' +
          'migrations here were applied by hand, and there is nothing to compare against',
      )
      process.exitCode = 2
      return
    }

    const rows =
      await sql`select name from supabase_migrations.schema_migrations`
    const gap = missing(
      await readdir(MIGRATIONS),
      rows.map((r) => r.name),
    )

    if (gap.length === 0) {
      console.log('schema is up to date with supabase/migrations')
      return
    }

    console.error(
      `${gap.length} migration(s) in the repository are not applied here:`,
    )
    for (const name of gap) console.error(`  ${name}`)
    process.exitCode = 1
  } finally {
    await sql.end()
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
