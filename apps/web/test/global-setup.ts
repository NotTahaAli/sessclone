import type { TestProject } from 'vitest/node'

// Once per run, before any test file. Applying the migrations here rather than
// in each file is what lets the files truncate instead of dropping the schema:
// dropping is what raced, and truncating cannot.
export default async function setup(project: TestProject) {
  // `test.env` is applied to the workers, not to this process — and the
  // connection strings live there because the application code under test
  // reads `process.env.DATABASE_URL` itself. Copying them across is what keeps
  // one default in one place rather than a copy here that drifts from it.
  Object.assign(process.env, project.config.env)

  // Imported after that, because the harness opens its pools at module scope.
  const { applyMigrations, closeConnections } = await import('./harness')

  await applyMigrations()
  // This process is not where the test files run, so the pools it opened are
  // not the pools they use: they close here and reopen there.
  await closeConnections()
}
