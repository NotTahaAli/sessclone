import { defineConfig } from 'vitest/config'

// Route and policy tests run against a real Postgres with the real migrations.
// The defaults are the local cluster README describes; CI overrides them with
// the service container's URLs.
//
// Two roles, because one of them is the point. `DATABASE_URL` owns the tables
// and so applies the migrations and seeds — and, owning them, is exempt from
// every policy they create. `APP_DATABASE_URL` is `sessclone_app`, which owns
// nothing and is what the dashboard connects as, so it is the only connection
// a policy test proves anything on.
//
// `INGEST_DATABASE_URL` is the third, and it is a separate variable rather
// than a reuse of the first: ingest writes `turns` and `log_artifacts`, which
// `sessclone_app` is granted no insert on by design, so a deployment points it
// at the owning role and a deployment that confuses the two finds out here
// rather than in production. It is the owning role for the same reason the
// application's is not.
//
// The three URLs are written here and nowhere else. `test.env` reaches the
// workers, which is where both the tests and the route code under test read
// them; `test/global-setup.ts` copies them into its own process, which
// `test.env` does not reach.
//
// The harness in `test/` is ticket 25: migrations apply once in `globalSetup`,
// every file truncates between tests through `setupFiles`, and the fixture
// covering each Role is seeded by whichever test wants it.
export default defineConfig({
  test: {
    name: 'web',
    // One database, several files that each write to it. Running them in
    // parallel has one file truncating under another's feet.
    fileParallelism: false,
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup.ts'],
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ??
        'postgres://sessclone:sessclone@127.0.0.1:5432/sessclone_test',
      APP_DATABASE_URL:
        process.env.APP_DATABASE_URL ??
        'postgres://sessclone_app:sessclone_app@127.0.0.1:5432/sessclone_test',
      // Ticket 119's lock is on by default; the suites that are not about it
      // run with it off, and `approval.test.ts`, `ingest.test.ts` and
      // `api-keys.test.ts` switch it on where the lock is the subject.
      SIGNUP_APPROVAL: 'off',
      INGEST_DATABASE_URL:
        process.env.INGEST_DATABASE_URL ??
        'postgres://sessclone:sessclone@127.0.0.1:5432/sessclone_test',
    },
  },
})
