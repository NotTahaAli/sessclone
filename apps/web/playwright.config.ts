import { defineConfig } from '@playwright/test'

// The browser flows AGENTS.md names as worth their cost, and only those
// (ticket 135). Anything a unit or database test proves stays there.
//
//   pnpm --filter web e2e     # starts `next dev` itself, unless one is up
//
// Two URLs, like `vitest.config.mts`: the owner applies the migrations and
// seeds, and the app reads as `sessclone_app`. The harness empties the
// database and refuses any whose name does not end in `_test`. Supabase Auth
// does not run: `e2e/global-setup.ts` serves its JWKS endpoint and signs the
// one session every test reuses.

export const OWNER_URL =
  process.env.DATABASE_URL ??
  'postgres://sessclone:sessclone@127.0.0.1:5432/sessclone_e2e_test'
const APP_URL =
  process.env.APP_DATABASE_URL ??
  'postgres://sessclone_app:sessclone_app@127.0.0.1:5432/sessclone_e2e_test'

export const AUTH_URL = 'http://127.0.0.1:54135'
export const BASE_URL = 'http://127.0.0.1:3135'
export const STATE = './e2e/.auth/state.json'

export default defineConfig({
  testDir: './e2e',
  // Not `*.spec.ts`, which Vitest's default include would also pick up.
  testMatch: '*.e2e.ts',
  globalSetup: './e2e/global-setup.ts',
  // One seeded person across the flows, so one at a time.
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    storageState: STATE,
  },
  webServer: {
    command: 'pnpm exec next dev --port 3135 --hostname 127.0.0.1',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      DATABASE_URL: APP_URL,
      INGEST_DATABASE_URL: OWNER_URL,
      NEXT_PUBLIC_SUPABASE_URL: AUTH_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'e2e',
      NEXT_PUBLIC_APP_URL: BASE_URL,
      // SIGNUP_APPROVAL stays on, the default: a New Org lands on the
      // waiting page because of it.
    },
  },
})
