import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import postgres from 'postgres'
import { describe, expect, it } from 'vitest'
// @ts-expect-error — a plain script, deliberately outside the TypeScript build.
import { appRole, header, plan, scram } from '../scripts/setup-db.mjs'
import { owner } from './harness'

const SCRIPT = fileURLToPath(
  new URL('../scripts/setup-db.mjs', import.meta.url),
)
const run = (env: Record<string, string>) =>
  promisify(execFile)(process.execPath, [SCRIPT], {
    env: { ...process.env, ...env },
  }).then(
    ({ stdout }) => ({ code: 0, out: stdout }),
    (error: { code: number; stdout: string; stderr: string }) => ({
      code: error.code,
      out: error.stdout + error.stderr,
    }),
  )
const withDatabase = (url: string, database: string) => {
  const u = new URL(url)
  u.pathname = `/${database}`
  return u.toString()
}

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
      held: [],
    })
  })

  // The live code still needs what that file removes, so an upgrade holds it
  // back — and only it: the code about to deploy needs every other file.
  it('holds back only the after-deploy files on an upgrade', () => {
    expect(plan(files, [{ version: 'a', name: 'a_one' }], headers)).toEqual({
      apply: ['b_two.sql', 'd_four.sql'],
      held: ['c_drop.sql'],
    })
  })

  it('runs the after-deploy file when told the deploy is done', () => {
    expect(
      plan(files, [{ version: 'a', name: 'a_one' }], headers, {
        afterDeploy: true,
      }),
    ).toEqual({ apply: ['b_two.sql', 'c_drop.sql', 'd_four.sql'], held: [] })
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
    ).toEqual(['d_four.sql'])
  })

  it('applies nothing when the ledger is complete', () => {
    const all = ['a', 'b', 'c', 'd'].map((version) => ({ version, name: '' }))
    expect(plan(files, all, headers)).toEqual({ apply: [], held: [] })
  })
})

describe('the after-deploy marker', () => {
  // Found anywhere in the leading comment block, even wrapped over two lines;
  // a marker missed is a migration that breaks the live code before deploy.
  it('is read from the whole leading comment, wrapped or not', () => {
    const source =
      '-- Ticket 9.\n--\n-- Then: RUN THIS AFTER\n--   THE DEPLOY, never before.\nalter table x;\n-- RUN THIS AFTER THE DEPLOY'
    expect(header(source)).toMatch(/RUN THIS AFTER THE DEPLOY/)
    expect(header(source)).not.toMatch(/alter table/)
  })

  it('is found in the repository’s own after-deploy migrations', async () => {
    const dir = new URL('../../../supabase/migrations/', import.meta.url)
    const { readFile, readdir } = await import('node:fs/promises')
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql'))
    const marked = []
    for (const f of files) {
      // oxlint-disable-next-line no-await-in-loop -- a few dozen small files.
      const text = await readFile(new URL(f, dir), 'utf8')
      if (/RUN THIS AFTER THE DEPLOY/.test(header(text))) marked.push(f)
    }
    expect(marked).toEqual(
      expect.arrayContaining([
        '20260923140000_artifact_kind_drop_old_key.sql',
        '20260925170000_drop_one_argument_accept.sql',
      ]),
    )
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

// Against the real cluster: the parts no unit test can prove.
describe('setup against a database', () => {
  // A database migrated by the old `psql` loop has tables and no ledger. The
  // test database is exactly that, and must be left without one: an empty
  // ledger would make schema-drift call every migration missing.
  it('refuses a database migrated by hand, and writes nothing to it', async () => {
    const result = await run({
      INGEST_DATABASE_URL: process.env.DATABASE_URL!,
      DATABASE_URL: process.env.APP_DATABASE_URL!,
    })
    expect(result.code).toBe(1)
    expect(result.out).toMatch(/migrated by hand/)
    const [row] = await owner`
      select to_regclass('supabase_migrations.schema_migrations') as ledger
    `
    expect(row?.ledger).toBeNull()
  })

  // Fresh, then again: everything applies once, the second run applies
  // nothing, and both end on Postgres's own word that policies apply.
  it('migrates an empty database, and a second run is a no-op', async () => {
    const database = 'sessclone_setup_test'
    await owner.unsafe(`drop database if exists ${database}`)
    await owner.unsafe(`create database ${database}`)
    try {
      const env = {
        INGEST_DATABASE_URL: withDatabase(process.env.DATABASE_URL!, database),
        DATABASE_URL: withDatabase(process.env.APP_DATABASE_URL!, database),
      }
      const first = await run(env)
      expect(first.out).toMatch(/applying 20260920120000_accounts … done/)
      expect(first.out).toMatch(/row-level security applies/)
      expect(first.code).toBe(0)

      const second = await run(env)
      expect(second.out).toMatch(/no migrations to apply/)
      expect(second.code).toBe(0)
    } finally {
      await owner.unsafe(`drop database if exists ${database} with (force)`)
    }
  }, 120_000)

  // `sessclone_app` is cluster-wide: a mistyped password must stop the run,
  // not become the password every deployment on this cluster logs in with.
  it('refuses a wrong password for a role that can already log in', async () => {
    const database = 'sessclone_setup_wrongpw'
    await owner.unsafe(`drop database if exists ${database}`)
    await owner.unsafe(`create database ${database}`)
    const real = new URL(process.env.APP_DATABASE_URL!)
    const wrong = new URL(withDatabase(real.toString(), database))
    wrong.password = 'not-the-password'
    try {
      const result = await run({
        INGEST_DATABASE_URL: withDatabase(process.env.DATABASE_URL!, database),
        DATABASE_URL: wrong.toString(),
      })
      expect(result.code).toBe(1)
      expect(result.out).toMatch(/already has a login/)
      const app = postgres(real.toString(), { max: 1 })
      try {
        const [row] = await app`select current_user as role`
        expect(row?.role).toBe('sessclone_app')
      } finally {
        await app.end()
      }
    } finally {
      // Undo a rotation should the guard ever regress, so later suites log in.
      await owner.unsafe(
        `alter role sessclone_app password '${scram(decodeURIComponent(real.password))}'`,
      )
      await owner.unsafe(`drop database if exists ${database} with (force)`)
    }
  }, 120_000)

  // The password reaches the server only as this verifier; a wrong one would
  // lock the dashboard out of its own database.
  it('writes a SCRAM verifier Postgres accepts', async () => {
    await owner.unsafe('drop role if exists sessclone_scram_probe')
    await owner.unsafe(
      `create role sessclone_scram_probe login password '${scram('pa ss')}'`,
    )
    const url = new URL(process.env.DATABASE_URL!)
    url.username = 'sessclone_scram_probe'
    url.password = 'pa ss'
    const probe = postgres(url.toString(), { max: 1 })
    try {
      const [row] = await probe`select current_user as role`
      expect(row?.role).toBe('sessclone_scram_probe')
    } finally {
      await probe.end()
      await owner.unsafe('drop role sessclone_scram_probe')
    }
  })
})
