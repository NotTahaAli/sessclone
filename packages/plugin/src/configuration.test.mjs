import { expect, test } from 'vitest'

import {
  ConfigurationError,
  DEFAULT_URL,
  nodeProblem,
  readConfiguration,
} from './configuration.mjs'

/** A key of the shape `generateApiKey` issues: `sk_` and 43 base64url chars. */
const KEY = `sk_${'a'.repeat(43)}`

/** The minimum that resolves, so each test below varies one thing. */
const valid = { SESSCLONE_API_KEY: KEY, SESSCLONE_STATE_DIR: '/tmp/sessclone' }

/** @param {Record<string, string | undefined>} env */
const problemsFrom = (env, platform = /** @type {const} */ ('linux')) => {
  try {
    readConfiguration(env, platform)
  } catch (error) {
    if (error instanceof ConfigurationError) return error.problems
    throw error
  }
  return []
}

test('a key and nothing else resolves, with the documented URL default', () => {
  const config = readConfiguration(valid, 'linux')

  expect(config.apiKey).toBe(KEY)
  expect(config.url).toBe(DEFAULT_URL)
  expect(config.device).toBeUndefined()
})

test('a missing key is refused, naming where to get one', () => {
  const [problem] = problemsFrom({ SESSCLONE_STATE_DIR: '/tmp/sessclone' })

  expect(problem).toContain('No API key')
  expect(problem).toContain('Keys')
})

test("the plugin's own setup answers count as configuration", () => {
  // `userConfig` in `.claude-plugin/plugin.json`: Claude Code asks for these
  // when the plugin is enabled and hands them to a hook as
  // `CLAUDE_PLUGIN_OPTION_*`. It is the only route on a machine where nobody
  // can export anything — the desktop app — and the key is kept in the OS
  // keychain rather than in a file anybody can read.
  const config = readConfiguration(
    {
      CLAUDE_PLUGIN_OPTION_API_KEY: KEY,
      CLAUDE_PLUGIN_OPTION_URL: 'https://sessclone.example.com/',
      SESSCLONE_STATE_DIR: '/tmp/sessclone',
    },
    'linux',
  )

  expect(config.apiKey).toBe(KEY)
  expect(config.url).toBe('https://sessclone.example.com')
})

test('an exported variable wins over the setup answer', () => {
  // Somebody exporting one is doing it deliberately, usually to point one
  // shell at a second deployment.
  const config = readConfiguration(
    {
      ...valid,
      SESSCLONE_URL: 'https://exported.example.com',
      CLAUDE_PLUGIN_OPTION_API_KEY: `sk_${'z'.repeat(43)}`,
      CLAUDE_PLUGIN_OPTION_URL: 'https://configured.example.com',
    },
    'linux',
  )

  expect(config.apiKey).toBe(KEY)
  expect(config.url).toBe('https://exported.example.com')
})

test('an empty key is a missing key, not a key', () => {
  expect(problemsFrom({ ...valid, SESSCLONE_API_KEY: '   ' })).toHaveLength(1)
})

test('a malformed key is refused at setup rather than at report time', () => {
  // The failure this criterion exists for: a key pasted from a wrapped line,
  // which is well-formed enough to send and rejected by every report.
  expect(
    problemsFrom({ ...valid, SESSCLONE_API_KEY: KEY.slice(0, 30) }),
  ).toEqual([expect.stringContaining('not a sessclone key')])
  expect(
    problemsFrom({ ...valid, SESSCLONE_API_KEY: `pk_${'a'.repeat(43)}` }),
  ).toEqual([expect.stringContaining('not a sessclone key')])
})

test('no message ever carries the key itself', () => {
  // The acceptance criterion about logs and transcripts, made a test: a hook's
  // stderr is shown in a session, and a session is a transcript this product
  // uploads. A message that quotes the key puts it in both.
  const secret = `sk_${'z'.repeat(60)}`
  const problems = problemsFrom({ ...valid, SESSCLONE_API_KEY: secret })

  expect(problems).toHaveLength(1)
  expect(problems.join(' ')).not.toContain(secret)
  expect(problems.join(' ')).not.toContain('z'.repeat(8))
})

test('every problem is reported at once, not one restart at a time', () => {
  const problems = problemsFrom({
    SESSCLONE_API_KEY: 'nope',
    SESSCLONE_URL: 'not a url',
    SESSCLONE_STATE_DIR: '/tmp/sessclone',
  })

  expect(problems).toHaveLength(2)
})

test('a self-hoster points at their own deployment', () => {
  expect(
    readConfiguration(
      { ...valid, SESSCLONE_URL: 'https://sessclone.example.com' },
      'linux',
    ).url,
  ).toBe('https://sessclone.example.com')
})

test('a trailing slash is trimmed rather than refused', () => {
  // `https://example.com/` is what a browser's address bar hands over, and an
  // untrimmed base makes every call `//api/ingest`.
  expect(
    readConfiguration(
      { ...valid, SESSCLONE_URL: 'https://sessclone.example.com/' },
      'linux',
    ).url,
  ).toBe('https://sessclone.example.com')
})

test('a URL that is not http or https is refused, naming the protocol', () => {
  expect(
    problemsFrom({ ...valid, SESSCLONE_URL: 'postgres://db/sessclone' }),
  ).toEqual([expect.stringContaining('must be http or https')])
})

test('an unset URL is the default, and an empty one is not a refusal', () => {
  expect(readConfiguration({ ...valid, SESSCLONE_URL: '' }, 'linux').url).toBe(
    DEFAULT_URL,
  )
})

test('the state directory follows the platform, and never lands under ~/.claude', () => {
  // Finding 06: Claude Code's own sweep deletes everything under
  // `~/.claude/projects/` after 30 days, cursor and retry queue included.
  const linux = readConfiguration(
    { SESSCLONE_API_KEY: KEY, XDG_STATE_HOME: '/state' },
    'linux',
  )
  expect(linux.stateDir).toBe('/state/sessclone')

  const mac = readConfiguration({ SESSCLONE_API_KEY: KEY }, 'darwin')
  expect(mac.stateDir).toMatch(/Library\/Application Support\/sessclone$/)

  const windows = readConfiguration(
    { SESSCLONE_API_KEY: KEY, LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' },
    'win32',
  )
  expect(windows.stateDir).toContain('sessclone')

  for (const config of [linux, mac, windows]) {
    expect(config.stateDir).not.toContain('.claude')
  }
})

test('a pinned device key is used verbatim', () => {
  // The way one account running several environments counts them separately,
  // and the way an identity survives a rename.
  expect(
    readConfiguration({ ...valid, SESSCLONE_DEVICE: 'ci:fleet-3' }, 'linux')
      .device,
  ).toBe('ci:fleet-3')
})

test('a Node too old to run the Collector is a problem named at session start', () => {
  // The hooks import `packages/shared` as TypeScript and rely on Node
  // stripping the types. On Node 20 that throws `Unknown file extension
  // ".ts"` inside a hook, where every failure is swallowed — so without this
  // check the plugin installs, starts cleanly and silently reports nothing.
  expect(nodeProblem('20.11.0')).toMatch(/too old/)
  expect(nodeProblem('22.17.9')).toMatch(/22\.18 or newer/)
  expect(nodeProblem('23.5.0')).toMatch(/too old/)

  expect(nodeProblem('22.18.0')).toBeNull()
  expect(nodeProblem('23.6.0')).toBeNull()
  expect(nodeProblem('24.2.1')).toBeNull()

  // And it never names the key, as no problem here ever does.
  expect(nodeProblem('20.11.0')).not.toMatch(/sk_/)
})
