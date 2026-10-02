// `/sessclone-status`: what this machine reports, where, and what the
// deployment said at session start. Plain lines, always exit 0.
//
// It reads rather than asks. Claude Code hands the setup prompt's answers,
// the key among them, only to hooks and to the plugin's own mod, never to a
// command Claude runs, so the session-start hook records its check in the
// state directory (`connection.mjs`) and this prints it. The key never
// appears here: only the first three characters and the length the hook
// recorded.
//
// `--session <id>` adds how many of that session's Turns are not sent yet.
// `--json` prints the same facts as one JSON object, for the status bar the
// mod draws (`hooks/register.tsx`).

import { hostname } from 'node:os'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    json: { type: 'boolean', default: false },
    session: { type: 'string' },
  },
  strict: false,
})

try {
  const { defaultStateDir, nodeProblem } =
    await import('../src/configuration.mjs')
  const { readChecked } = await import('../src/connection.mjs')
  const { readAnswer } = await import('../src/last-answer.mjs')
  const { queued } = await import('../src/queue.mjs')

  const stateDir =
    process.env.SESSCLONE_STATE_DIR?.trim() ||
    defaultStateDir(process.platform, process.env)
  if (!stateDir) throw new Error('no state directory on this platform')

  const checked = await readChecked(stateDir)
  const answer = await readAnswer(stateDir)
  // TypeScript, which a Node too old for the Collector cannot load.
  const oldNode = nodeProblem(process.versions.node) !== null
  const device = await import('../src/shared/identity.ts')
    .then(({ deviceKey }) =>
      deviceKey({ hostname: hostname(), environment: process.env }),
    )
    .catch(() => null)
  const sessionId = typeof values.session === 'string' ? values.session : null
  const unsent =
    sessionId && !oldNode
      ? await import('../src/report.mjs').then(({ unsentTurns }) =>
          unsentTurns({
            sessionId,
            transcriptPath: undefined,
            environment: process.env,
            stateDir,
          }),
        )
      : null
  const waiting = await queued(stateDir)

  if (values.json) {
    console.log(
      JSON.stringify({
        url: checked?.url ?? null,
        connection: checked?.state ?? 'unchecked',
        org: checked?.org ?? null,
        checkedAt: checked?.at ?? null,
        oldNode,
        queued: waiting,
        unsent,
        lastPush: answer,
      }),
    )
  } else {
    const connection = !checked
      ? 'not checked yet: the deployment has not answered a key check'
      : checked.state === 'connected'
        ? `connected${checked.org ? `, reporting to ${checked.org}` : ''}`
        : 'NOT connected: the deployment refused the key'

    console.log(
      [
        `Deployment: ${checked?.url ?? 'unknown until a session starts'}`,
        `API key: ${checked ? (checked.key ? `${checked.key.prefix}…, ${checked.key.length} characters` : 'none set (a cloud proxy may add one)') : 'unknown until a session starts'}`,
        `Connection: ${connection}${checked ? ` (checked ${checked.at})` : ''}`,
        `Device: ${device ?? '(needs Node 22.18 or newer)'}`,
        ...(unsent === null
          ? []
          : [
              `This session: ${unsent === 0 ? 'synced' : `${unsent} Turn${unsent === 1 ? '' : 's'} not sent yet`}`,
            ]),
        `Waiting to send: ${waiting}`,
        `Last push: ${answer ? `${answer.at}, answered ${answer.status ?? 'nothing (unreachable)'}` : 'none yet'}`,
      ].join('\n'),
    )
    if (checked?.state === 'refused') {
      console.log(
        '\nCreate a key under Keys in the dashboard, run /plugin configure sessclone to enter it, and start a new session.',
      )
    }
  }
} catch (error) {
  console.log(
    values.json
      ? JSON.stringify({ error: String(error) })
      : `sessclone status could not be read: ${String(error)}`,
  )
}
