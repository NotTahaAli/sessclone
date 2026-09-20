import { defineConfig } from 'vitest/config'

// Route tests run against a real Postgres with the real migrations. The
// defaults are the local cluster README describes; CI overrides them with the
// service container's URLs.
//
// Two roles, because one of them is the point. `DATABASE_URL` owns the tables
// and so applies the migrations and seeds — and, owning them, is exempt from
// every policy they create. `APP_DATABASE_URL` is `sessclone_app`, which owns
// nothing and is what the dashboard connects as, so it is the only connection
// a policy test proves anything on.
export default defineConfig({
  test: {
    name: 'web',
    // One database, several files that each reset it. Running them in parallel
    // has one file dropping the schema under another's feet.
    fileParallelism: false,
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ??
        'postgres://sessclone:sessclone@127.0.0.1:5432/sessclone_test',
      APP_DATABASE_URL:
        process.env.APP_DATABASE_URL ??
        'postgres://sessclone_app:sessclone_app@127.0.0.1:5432/sessclone_test',
    },
  },
})
