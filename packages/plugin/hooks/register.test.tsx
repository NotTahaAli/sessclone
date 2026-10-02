// The mod under `claude plugin test packages/plugin`: what the commands run,
// and what the bar draws from what `status.mjs --json` printed. Vitest skips
// this file (vitest.config.mts); the words themselves are `bar.test.mjs`'s.

import { expect, mock, test } from 'claude-code/testing'

const STANDING = {
  url: 'https://sessclone.com',
  connection: 'connected',
  org: 'Acme',
  checkedAt: '2026-10-02T10:00:00.000Z',
  oldNode: false,
  queued: 0,
  unsent: 2,
  lastPush: { status: 200, at: '2026-10-02T10:00:00.000Z' },
}

const ran = (stdout: string) => ({
  value: {
    exitCode: 0,
    stdout,
    stderr: '',
    isStdoutTruncated: false,
    isStderrTruncated: false,
  },
})

test(
  'the bar shows the connection, what is behind, and links to the session',
  { options: { api_key: 'sk_test_key' } },
  async ($, on) => {
    const clock = mock.clock(on)
    const runs: { argv: readonly string[]; env?: Record<string, string> }[] = []
    on('session.surfaces', () => ({ value: ['terminal'] }))
    on('session.id', () => ({ value: 'session-1' }))
    on('command.register', (_$, e) => ({ value: { command: e.name } }))
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('process.run', (_$, e) => {
      runs.push({ argv: e.argv, env: e.init?.env })
      return ran(JSON.stringify(STANDING))
    })

    await $.session.start({
      cwd: '/',
      surface: 'terminal',
      isInteractive: true,
    })
    await clock.advance(1)

    expect(runs[0]?.argv.slice(-3)).toEqual([
      '--json',
      '--session',
      'session-1',
    ])
    expect(runs[0]?.env?.CLAUDE_PLUGIN_OPTION_API_KEY).toBe('sk_test_key')

    /* oxlint-disable no-await-in-loop -- one drawing per surface, in turn */
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({
        plugin: 'sessclone',
        surface,
        component: 'AbovePrompt',
        props: {
          hasSurvey: false,
          isWorking: false,
          maxRows: 10,
          bodyColumns: 100,
          scroll: { offset: 0, bodyRows: 10 },
          view: {},
        },
      })
      expect(
        await ui.find({
          type: 'Text',
          text: /connected · Acme · 2 Turns behind/,
        }),
      ).toBeDefined()
      expect((await ui.find({ type: 'Link' }))?.props?.href).toBe(
        'https://sessclone.com/sessions/session-1',
      )
      await ui.unmount()
    }
    /* oxlint-enable no-await-in-loop */
  },
)

test('sync runs the sync script and prints its line', async ($, on) => {
  mock.clock(on)
  on('session.surfaces', () => ({ value: [] }))
  on('session.id', () => ({ value: 'session-1' }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('process.run', (_$, e) =>
    ran(
      e.argv.some((part) => part.endsWith('/scripts/sync.mjs'))
        ? 'Synced to https://sessclone.com: 3 waiting before, 0 now.\n'
        : '',
    ),
  )

  await $.session.start({ cwd: '/', surface: null, isInteractive: false })
  const { text } = await $.command.run({
    command: 'sessclone-sync',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 100 },
  })

  expect(text).toBe('Synced to https://sessclone.com: 3 waiting before, 0 now.')
})

test('the fallback skills leave the menu where the mod loads', async ($, on) => {
  on('command.describe', (_$, e) => ({
    description: e.description,
    isHidden: e.isHidden,
  }))
  const describe = (command: string) =>
    $.command.describe({
      command,
      description: 'x',
      isHidden: false,
      immediate: false,
      provider: { plugin: 'sessclone', tier: 'user' },
    })

  expect((await describe('sessclone:status')).isHidden).toBe(true)
  expect((await describe('sessclone:sync')).isHidden).toBe(true)
  expect((await describe('sessclone-status')).isHidden).toBe(false)
})
