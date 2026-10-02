// `/sessclone-sync`: send everything the Collector has waiting, now.
//
// The plugin's mod (`hooks/register.tsx`) runs this with the setup prompt's
// answers in the environment, as Claude Code gives them to a hook, so it
// does what the session-start hook does without waiting for a session to
// start: check the key, then drain the queue and flush every session from
// its cursor, time-boxed. One line out, always exit 0.

import {
  ConfigurationError,
  readConfiguration,
  nodeProblem,
} from '../src/configuration.mjs'
import { throughProxy } from '../src/proxy.mjs'

/** Under the 30 seconds the mod gives this process. */
const BUDGET_MS = 20_000

throughProxy()

const node = nodeProblem(process.versions.node)
if (node) {
  console.log(node)
  process.exit(0)
}

try {
  const configuration = readConfiguration()
  const { checkConnection, recordConnection } =
    await import('../src/connection.mjs')
  const connection = await checkConnection(configuration)
  await recordConnection(configuration, connection)

  if (connection.state === 'refused') {
    console.log(
      `Did not sync: ${configuration.url} refused the key. Create one under Keys, run /plugin configure sessclone, and start a new session.`,
    )
  } else {
    const { sweep } = await import('../src/report.mjs')
    const { queued } = await import('../src/queue.mjs')
    const before = await queued(configuration.stateDir)
    const started = Date.now()
    await sweep({
      configuration,
      environment: process.env,
      budgetMs: BUDGET_MS,
    })
    const after = await queued(configuration.stateDir)
    const unreachable =
      connection.state === 'unknown' && connection.status === null
    console.log(
      unreachable
        ? `Could not reach ${configuration.url}. ${after} waiting; the next session start tries again.`
        : `Synced to ${configuration.url}: ${before} waiting before, ${after} now.${Date.now() - started >= BUDGET_MS ? ' Out of time; the next session start sends the rest.' : ''}`,
    )
  }
} catch (error) {
  console.log(
    error instanceof ConfigurationError
      ? `Not configured: ${error.problems.join('; ')}`
      : // The name only: this line is the command's output, which the model
        // reads and the transcript keeps, and an error's message can carry
        // what the configuration held, the key among it.
        `Sync failed (${error instanceof Error ? error.name : 'unknown error'}). The next session start tries again.`,
  )
}
