import { defineConfig } from 'vitest/config'

// The Collector's own tests. Pure Node, no environment and no database: what
// is proven here is that a machine's environment resolves to a configuration,
// or fails naming the variable to fix.
export default defineConfig({
  test: {
    name: 'plugin',
  },
})
