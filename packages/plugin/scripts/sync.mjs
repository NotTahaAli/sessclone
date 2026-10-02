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
  } else if (connection.state === 'unknown' && connection.status === null) {
    // Nothing would land: leave the sweep to the next session start.
    const { queued } = await import('../src/queue.mjs')
    console.log(
      `Could not reach ${configuration.url}. ${await queued(configuration.stateDir)} waiting; the next session start tries again.`,
    )
  } else {
    const { sweep } = await import('../src/report.mjs')
    const { queued } = await import('../src/queue.mjs')
    const { readAnswer } = await import('../src/last-answer.mjs')
    const before = await queued(configuration.stateDir)
    const started = new Date()
    await sweep({
      configuration,
      environment: process.env,
      budgetMs: BUDGET_MS,
    })
    const after = await queued(configuration.stateDir)
    const answer = await readAnswer(configuration.stateDir)
    const answered =
      answer && Date.parse(answer.at) >= started.getTime() ? answer.status : 200
    console.log(
      answered === null || answered >= 300
        ? `Sync did not land: ${configuration.url} answered ${answered ?? 'nothing'}. ${after} waiting; the next session start tries again.`
        : `Synced to ${configuration.url}: ${before} waiting before, ${after} now.${Date.now() - started.getTime() >= BUDGET_MS ? ' Out of time; the next session start sends the rest.' : ''}`,
    )
  }
} catch (error) {
  // Fixed words, nothing taken from the error: this line is the command's
  // output, which the model reads and the transcript keeps, and an error can
  // carry what the configuration held, the key among it. A session start
  // names a configuration problem in full.
  console.log(
    error instanceof ConfigurationError
      ? 'Not configured: start a new session to see what to fix, or run /plugin configure sessclone.'
      : 'Sync failed. The next session start tries again; SESSCLONE_DEBUG=1 shows why in its hooks.',
  )
}
