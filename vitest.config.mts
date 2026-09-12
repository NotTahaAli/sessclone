import { defineConfig } from 'vitest/config'

// Vitest 5 removed vitest.workspace.ts; projects live here. Globbing the
// workspace folders means a package that later needs its own environment
// (jsdom for the app, a Postgres setup for route tests) is picked up by adding
// its vitest.config.ts, not by remembering to edit a root script.
export default defineConfig({
  test: {
    projects: ['apps/*', 'packages/*'],
  },
})
