import { configDefaults, defineConfig } from 'vitest/config'

// The Collector's own tests. Pure Node, no environment and no database: what
// is proven here is that a machine's environment resolves to a configuration,
// or fails naming the variable to fix.
//
// The mod's own test runs under `claude plugin test packages/plugin`, in
// Claude Code's environment, which vitest has no stand-in for.
export default defineConfig({
  test: {
    name: 'plugin',
    exclude: [...configDefaults.exclude, 'hooks/*.test.tsx'],
  },
})
