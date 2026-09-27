// `/sessclone:status`: what this machine reports, where, and what the
// deployment said at session start. Plain lines, always exit 0.
//
// It reads rather than asks. Claude Code hands the setup prompt's answers,
// the key among them, only to hooks, never to a command Claude runs, so the
// session-start hook records its check in the state directory
// (`connection.mjs`) and this prints it. The key never appears here: only
// the first three characters and the length the hook recorded.

import { hostname } from 'node:os'

try {
  const { defaultStateDir } = await import('../src/configuration.mjs')
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
  const device = await import('../src/shared/identity.ts')
    .then(({ deviceKey }) =>
      deviceKey({ hostname: hostname(), environment: process.env }),
    )
    .catch(() => '(needs Node 22.18 or newer)')

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
      `Device: ${device}`,
      `Waiting to send: ${await queued(stateDir)}`,
      `Last push: ${answer ? `${answer.at}, answered ${answer.status ?? 'nothing (unreachable)'}` : 'none yet'}`,
    ].join('\n'),
  )
} catch (error) {
  console.log(`sessclone status could not be read: ${String(error)}`)
}
