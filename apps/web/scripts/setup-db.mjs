// One command from an empty database to a working one, and from an old one to
// a current one.
//
//   INGEST_DATABASE_URL=… DATABASE_URL=… node apps/web/scripts/setup-db.mjs
//
// The two variables are the application's own (`.env.example`):
// `INGEST_DATABASE_URL` is the owning role, which applies the migrations, and
// `DATABASE_URL` is `sessclone_app`, the role the dashboard reads as. Run it
// with the same values the deployment has and it:
//
//   1. applies every migration in `supabase/migrations` this database has not
//      had, each in its own transaction, in filename order;
//   2. records each in `supabase_migrations.schema_migrations`, the ledger
//      `schema-drift.mjs` reads, creating it if it is not there;
//   3. gives `sessclone_app` its login and the password in `DATABASE_URL`,
//      unless that URL already connects;
//   4. connects as `DATABASE_URL` and checks it is the unprivileged role,
//      because pointing it at the owner switches row-level security off with
//      no error anywhere to say so.
//
// Running it again applies nothing and says so. On an upgrade it stops before
// a migration whose header says RUN THIS AFTER THE DEPLOY, since the code
// still live depends on what that file removes: deploy, then run it again with
// `--after-deploy`. A fresh database has no live code, so it applies them all.
//
// After the first sign-in, the same script makes that person platform admin —
// the one grant the panel cannot make, because only a platform admin may:
//
//   INGEST_DATABASE_URL=… node apps/web/scripts/setup-db.mjs --admin you@example.com
//
// A database migrated by hand (the `psql` loop in `docs/self-hosting.md`) has
// tables and no ledger. The script refuses it rather than re-running the first
// migration over live data; keep upgrading that one by hand.

import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import postgres from 'postgres'

const MIGRATIONS = new URL('../../../supabase/migrations/', import.meta.url)
const AFTER_DEPLOY = /RUN THIS AFTER THE DEPLOY/

/**
 * Which migrations to apply now, and which one an upgrade stops at.
 *
 * `files` is the directory listing, `ledger` the rows already recorded, and
 * `headers` maps a file to its first lines. A row counts as a file when either
 * its version (the timestamp prefix) or its name (the whole stem) matches:
 * the Supabase CLI writes the short name, a hand-applied row the stem.
 */
export const plan = (files, ledger, headers, { afterDeploy = false } = {}) => {
  const versions = new Set(ledger.map((row) => row.version))
  const names = new Set(ledger.map((row) => row.name))
  const pending = files
    .filter((f) => f.endsWith('.sql'))
    .toSorted()
    .filter((f) => {
      const stem = f.replace(/\.sql$/, '')
      return !versions.has(stem.split('_')[0]) && !names.has(stem)
    })

  // A fresh database runs everything: there is no live code to break.
  if (ledger.length === 0 || afterDeploy) return { apply: pending, held: null }

  const stop = pending.findIndex((f) => AFTER_DEPLOY.test(headers[f] ?? ''))
  if (stop === -1) return { apply: pending, held: null }
  return { apply: pending.slice(0, stop), held: pending[stop] }
}

/** `sessclone_app`, or `sessclone_app.<ref>` through Supabase's pooler. */
export const appRole = (url) => {
  const { username, password } = new URL(url)
  const user = decodeURIComponent(username)
  if (user !== 'sessclone_app' && !user.startsWith('sessclone_app.')) {
    throw new Error(
      `DATABASE_URL connects as ${user}, not sessclone_app — the dashboard must read as the role that owns nothing`,
    )
  }
  if (!password) throw new Error('DATABASE_URL has no password in it')
  return decodeURIComponent(password)
}

const connect = (url) =>
  // `prepare: false` as in `apps/web/lib/db.ts`: a transaction-mode pooler
  // hands the next statement to another backend. `onnotice` because every
  // `create … if not exists` would otherwise print a line.
  postgres(url, { prepare: false, max: 1, onnotice: () => {} })

const migrate = async (owner, afterDeploy) => {
  await owner.unsafe(`
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations
      (version text primary key, statements text[], name text);
  `)
  const ledger = await owner`
    select version, name from supabase_migrations.schema_migrations
  `
  if (ledger.length === 0) {
    const [{ present }] = await owner`
      select to_regclass('public.orgs') is not null as present
    `
    if (present) {
      throw new Error(
        'this database has SessClone tables and no migration ledger, so it was migrated by hand; ' +
          'apply new files by hand as docs/self-hosting.md describes rather than letting this re-run them',
      )
    }
  }

  const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql'))
  const sources = Object.fromEntries(
    await Promise.all(
      files.map(async (f) => [
        f,
        await readFile(new URL(f, MIGRATIONS), 'utf8'),
      ]),
    ),
  )
  const headers = Object.fromEntries(
    files.map((f) => [f, sources[f].split('\n', 3).join('\n')]),
  )
  const { apply, held } = plan(files, ledger, headers, { afterDeploy })

  for (const file of apply) {
    const stem = file.replace(/\.sql$/, '')
    process.stdout.write(`applying ${stem} … `)
    // oxlint-disable-next-line no-await-in-loop -- migrations apply in order.
    await owner
      .begin(async (tx) => {
        await tx.unsafe(sources[file])
        await tx`
          insert into supabase_migrations.schema_migrations (version, name)
          values (${stem.split('_')[0]}, ${stem})
        `
      })
      .catch((error) => {
        console.log('failed')
        // The one failure with a known fix: an owner without `createrole`
        // reaching the migration that creates `sessclone_app`.
        const hint = /permission denied to create role/.test(error.message)
          ? ' — create sessclone_app first, as a role that may: ' +
            "create role sessclone_app login password '<the password in DATABASE_URL>';"
          : ''
        throw new Error(`${stem}: ${error.message}${hint}`, {
          cause: error,
        })
      })
    console.log('done')
  }
  if (apply.length === 0) console.log('no migrations to apply')
  if (held) {
    console.log(
      `held back ${held}: its header says to run it after the deploy. ` +
        'Deploy this version, then run this again with --after-deploy.',
    )
  }
}

const ensureAppRole = async (owner, appUrl) => {
  const password = appRole(appUrl)
  const probe = connect(appUrl)
  try {
    await probe`select 1`
    return probe
  } catch {
    // Not yet able to log in, or a different password: set it below.
    await probe.end()
  }
  // The password goes through `format('%L')` on the server rather than
  // through string building here: `alter role` takes no bind parameter.
  const [{ statement }] = await owner`
    select format('alter role sessclone_app login password %L', ${password}::text) as statement
  `
  try {
    await owner.unsafe(statement)
  } catch (error) {
    throw new Error(
      `could not give sessclone_app its login (${error.message}). ` +
        'As a role that may manage roles, run: ' +
        "alter role sessclone_app login password '<the password in DATABASE_URL>';",
      { cause: error },
    )
  }
  console.log('gave sessclone_app its login')
  return connect(appUrl)
}

const verifyAppRole = async (app) => {
  try {
    const [row] = await app`
      select current_user as role,
             (select rolsuper or rolbypassrls from pg_roles where rolname = current_user) as exempt,
             (select tableowner = current_user from pg_tables
               where schemaname = 'public' and tablename = 'orgs') as owner
    `
    if (row.role !== 'sessclone_app' || row.exempt || row.owner) {
      throw new Error(
        `DATABASE_URL reads as ${row.role}, which row-level security does not apply to`,
      )
    }
    console.log(
      'DATABASE_URL reads as sessclone_app: row-level security applies',
    )
  } finally {
    await app.end()
  }
}

const grantAdmin = async (owner, email) => {
  // The guard trigger refuses this for every role, the owner included, so the
  // first admin steps around it once — inside one transaction, so the trigger
  // is never left off.
  const updated = await owner.begin(async (tx) => {
    await tx`alter table users disable trigger users_guard_platform_admin`
    const rows = await tx`
      update users set is_platform_admin = true
       where lower(email) = lower(${email}) returning id
    `
    await tx`alter table users enable trigger users_guard_platform_admin`
    return rows.length
  })
  if (updated === 0) {
    throw new Error(
      `no signed-in person has the address ${email}; sign in once, then run this again`,
    )
  }
  console.log(`${email} is now a platform admin`)
}

const main = async () => {
  const { values } = parseArgs({
    options: {
      'after-deploy': { type: 'boolean', default: false },
      admin: { type: 'string' },
    },
  })
  const ownerUrl = process.env.INGEST_DATABASE_URL
  if (!ownerUrl) throw new Error('INGEST_DATABASE_URL is not set')

  const owner = connect(ownerUrl)
  try {
    if (values.admin) {
      await grantAdmin(owner, values.admin)
      return
    }
    const appUrl = process.env.DATABASE_URL
    if (!appUrl) throw new Error('DATABASE_URL is not set')
    appRole(appUrl) // fail on a wrong role before touching the database
    await migrate(owner, values['after-deploy'])
    await verifyAppRole(await ensureAppRole(owner, appUrl))
  } finally {
    await owner.end()
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
