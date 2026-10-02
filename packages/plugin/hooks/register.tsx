// The plugin's mod (Claude Code 2.1.287 and later; older versions ignore
// `modules` in hooks.json and keep collecting through the settings hooks).
//
// Two commands, `/sessclone-status` and `/sessclone-sync`, and a one-line bar
// above the prompt: whether the key is connected, how many of this session's
// Turns are not sent yet, what is queued, and a link to this session in the
// dashboard.
//
// A mod has no Node, so the facts come from the scripts the skills
// run, started with `$.process.run`. The bar is refreshed when a session
// starts and after each turn's `Stop` hook has flushed, never on a timer:
// nothing the bar shows changes in between.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Standing } from '../types'

import { barParts, dotColor, optionEnvironment, sessionLink } from './bar.ts'

const standing = atom(
  { plugin: 'sessclone', key: 'standing' } as const,
  null as Standing | null,
)

/** The setup prompt's answers, as `register` received them. */
let optionEnv: Record<string, string> = {}

const script = ($: EngineInterface, name: string, args: string[] = []) =>
  $.process.run(['node', `${$.plugin.root}/scripts/${name}`, ...args], {
    env: optionEnv,
    timeoutMs: 30_000,
  })

const refresh = async ($: EngineInterface) => {
  // `claude -p`, the SDK and cloud sessions draw nothing: no bar to feed.
  if ((await $.session.surfaces()).length === 0) return
  const sessionId = await $.session.id()
  const { stdout } = await script($, 'status.mjs', [
    '--json',
    '--session',
    sessionId,
  ])
  const parsed = JSON.parse(stdout)
  if (parsed.error) return
  await update($, standing, () => ({ ...parsed, sessionId }))
}

/** After the dispatch that asked, so a turn never waits on the bar. */
const refreshSoon = ($: EngineInterface) => {
  $.clock.after(0, () => refresh($).catch(() => undefined))
}

export const register: Register = (on, options) => {
  optionEnv = optionEnvironment(options)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'sessclone-status',
      description:
        'Shows whether the sessclone Collector is connected, which Org it reports to, and what is waiting to send.',
      immediate: true,
    })
    await $.command.register({
      name: 'sessclone-sync',
      description:
        'Sends everything the sessclone Collector has waiting now, instead of at the next session start.',
    })
    refreshSoon($)
    return next(e)
  })

  // Both after the settings hooks beneath have run: the session-start check
  // has recorded the connection, and `Stop` has flushed the turn.
  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    refreshSoon($)
    return result
  })
  on('classic.Stop', async ($, e, next) => {
    const result = await next(e)
    refreshSoon($)
    return result
  })

  // The skills `/sessclone:status` and `/sessclone:sync` stay for a Claude
  // Code that cannot load this mod (older than 2.1.287, or mods turned off).
  // Where it does load, the commands above replace them in the menu.
  for (const command of ['sessclone:status', 'sessclone:sync']) {
    on('command.describe', { command }, async ($, e, next) => ({
      ...(await next(e)),
      isHidden: true,
    }))
  }

  on('command.run', { command: 'sessclone-status' }, async ($) => {
    const { stdout } = await script($, 'status.mjs', [
      '--session',
      await $.session.id(),
    ])
    refreshSoon($)
    return { text: stdout.trim() || 'sessclone status printed nothing.' }
  })

  on('command.run', { command: 'sessclone-sync' }, async ($) => {
    const { stdout } = await script($, 'sync.mjs')
    refreshSoon($)
    return { text: stdout.trim() || 'sessclone sync printed nothing.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, standing)
    if (e.props.hasSurvey || !s) return next(e)

    const { Box, Text, Link } = $.ui.resolve(e)
    const href = sessionLink(s.url, s.sessionId)

    return (
      // Short of the band's own [-] mark, so the words are cut, not the link.
      <Box
        flexDirection="row"
        gap={1}
        width={Math.max(10, e.props.bodyColumns - 4)}
      >
        <Text color={dotColor(s)}>●</Text>
        <Box flexShrink={1}>
          <Text dimColor wrap="truncate-end">
            sessclone · {barParts(s).join(' · ')}
          </Text>
        </Box>
        {/* Kept whole when the line is cut: the words give way first. */}
        {href ? (
          <Box flexShrink={0}>
            <Text>
              <Link href={href} label="↗" />
            </Text>
          </Box>
        ) : null}
      </Box>
    )
  })
}
