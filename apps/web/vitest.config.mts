import { defineConfig } from 'vitest/config'

// Route tests run against a real Postgres with the real migrations. The
// default is the local cluster README describes; CI overrides it with the
// service container's URL.
export default defineConfig({
  test: {
    name: 'web',
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ??
        'postgres://sessclone:sessclone@127.0.0.1:5432/sessclone_test',
    },
  },
})
