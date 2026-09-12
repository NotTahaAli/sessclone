import { defineConfig } from 'vitest/config'

// Pure logic only — no environment, no database. The fixture corpus lives
// beside these tests so the parser and cost tests added later read the same
// bytes this package's redactor produced.
export default defineConfig({
  test: {
    name: 'shared',
  },
})
