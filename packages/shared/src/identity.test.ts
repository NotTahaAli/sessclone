import { describe, expect, test } from 'vitest'

import {
  deviceKey,
  normaliseRemote,
  projectKey,
  withoutEmbeddedCredentials,
} from './identity.ts'

// Ticket 30's acceptance criteria. These are the keys a dashboard groups by,
// so every case here is one a Member would otherwise see split in two.
describe('a git remote names one Project however it was cloned', () => {
  const SPELLINGS = [
    'git@github.com:NotTahaAli/sessclone.git',
    'git@github.com:NotTahaAli/sessclone',
    'https://github.com/NotTahaAli/sessclone.git',
    'https://github.com/nottahaali/sessclone',
    'https://github.com/NotTahaAli/sessclone/',
    'ssh://git@github.com/NotTahaAli/sessclone.git',
    'ssh://git@github.com:22/NotTahaAli/sessclone.git',
    'git://github.com/NotTahaAli/sessclone.git',
    'GIT@GITHUB.COM:NotTahaAli/sessclone.git',
  ]

  test.each(SPELLINGS)('%s is github.com/nottahaali/sessclone', (remote) => {
    expect(normaliseRemote(remote)).toBe('github.com/nottahaali/sessclone')
  })

  test.each(SPELLINGS)(
    '%s is one Project, wherever it was cloned to',
    (remote) => {
      // The checkbox is about the Project, not about the normalised string:
      // `projectKey` falls back to a per-machine local key whenever
      // `normaliseRemote` returns null, so a spelling it stopped reading would
      // split this repository into one Project per machine — with no failure
      // anywhere, because every key it produced would still be a valid key.
      expect(
        projectKey({ remote, cwd: '/wherever', hostname: 'a-machine' }).key,
      ).toBe(
        projectKey({
          remote: 'git@github.com:NotTahaAli/sessclone.git',
          cwd: '/somewhere/else',
          hostname: 'another-machine',
        }).key,
      )
    },
  )

  test('strips credentials a remote should never have carried', () => {
    expect(
      normaliseRemote('https://someone:ghp_asecret@github.com/Org/repo.git'),
    ).toBe('github.com/org/repo')
  })

  test('keeps the full path on a host that nests groups', () => {
    expect(
      normaliseRemote('https://gitlab.example.com/group/subgroup/repo.git'),
    ).toBe('gitlab.example.com/group/subgroup/repo')
  })

  test.each([
    ['', 'nothing at all'],
    ['   ', 'whitespace'],
    ['not a remote', 'prose'],
    ['TODO:fix', 'a bare word with a colon'],
    ['https://github.com', 'a host with no repository on it'],
    ['C:\\code\\repo', 'a Windows path'],
    ['/srv/git/repo.git', 'a local path'],
    ['git@github.com:22:owner/repo.git', 'a port where a path belongs'],
  ])('%s is not a Project key — %s', (remote) => {
    expect(normaliseRemote(remote)).toBeNull()
  })

  test('a file:// remote is not a host, whatever it looks like', () => {
    // Read as an scp remote it would parse as the host `file`, and every
    // machine holding a bare repo at that path would collapse into one
    // Project — the merge the local key exists to prevent.
    expect(normaliseRemote('file:///srv/git/repo.git')).toBeNull()
    expect(
      projectKey({
        remote: 'file:///srv/git/repo.git',
        cwd: '/a',
        hostname: 'first',
      }).key,
    ).not.toBe(
      projectKey({
        remote: 'file:///srv/git/repo.git',
        cwd: '/a',
        hostname: 'second',
      }).key,
    )
  })

  test('a hostile remote is read in linear time', () => {
    // Ingest runs this on request data. Each string once took a quadratic
    // backtrack: a run of dots in the scp authority, a run of slashes before
    // the end of the remote and of its path.
    const run = 50_000
    for (const remote of [
      `${'.'.repeat(run)} x`,
      `a${'/'.repeat(run)}x`,
      `https://h/a${'/'.repeat(run)}b`,
    ]) {
      const started = performance.now()
      normaliseRemote(remote)
      expect(performance.now() - started).toBeLessThan(200)
    }
  })
})

describe('the Project key', () => {
  test('is the normalised remote, with the reported one kept for debugging', () => {
    expect(
      projectKey({
        remote: 'git@github.com:NotTahaAli/sessclone.git',
        cwd: '/home/taha/code/sessclone',
        hostname: 'mbp-2',
      }),
    ).toEqual({
      key: 'github.com/nottahaali/sessclone',
      remote: 'git@github.com:NotTahaAli/sessclone.git',
    })
  })

  test('never retains a credential someone pasted into a remote', () => {
    // The key strips it either way. This is about the copy that is shipped to
    // ingest and shown on a dashboard: a token in a remote URL is live, and a
    // `projects` row is not a place anyone looks for a secret.
    const identity = projectKey({
      remote: 'https://someone:ghp_asecret@github.com/Org/repo.git',
      cwd: '/a',
      hostname: 'h',
    })

    expect(identity.remote).toBe('https://github.com/Org/repo.git')
    expect(identity.remote).not.toContain('ghp_asecret')
    expect(identity.key).toBe('github.com/org/repo')
  })

  test('strips a credential from a remote it cannot otherwise read', () => {
    expect(withoutEmbeddedCredentials('https://u:tok@host/only')).toBe(
      'https://host/only',
    )
    expect(withoutEmbeddedCredentials('git@github.com:Org/repo.git')).toBe(
      'git@github.com:Org/repo.git',
    )
  })

  test('is the same on two machines that cloned the same repository', () => {
    const laptop = projectKey({
      remote: 'git@github.com:NotTahaAli/sessclone.git',
      cwd: '/Users/someone/Projects/sessclone',
      hostname: 'mbp-2',
    })
    const server = projectKey({
      remote: 'https://github.com/nottahaali/sessclone',
      cwd: '/srv/build/sessclone',
      hostname: 'ci-runner',
    })

    expect(laptop.key).toBe(server.key)
  })

  test('is not the same repository on a different host', () => {
    expect(
      projectKey({
        remote: 'git@gitlab.com:NotTahaAli/sessclone.git',
        cwd: '/x',
        hostname: 'h',
      }).key,
    ).not.toBe(
      projectKey({
        remote: 'git@github.com:NotTahaAli/sessclone.git',
        cwd: '/x',
        hostname: 'h',
      }).key,
    )
  })

  describe('a directory that is not a repository', () => {
    test('keys by machine and absolute path, never a bare directory name', () => {
      const key = projectKey({
        remote: null,
        cwd: '/home/taha/scratch/notes',
        hostname: 'mbp-2',
      }).key

      expect(key).toBe('local:mbp-2:/home/taha/scratch/notes')
      expect(key).not.toBe(
        projectKey({
          remote: null,
          cwd: '/home/taha/archive/notes',
          hostname: 'mbp-2',
        }).key,
      )
    })

    test('does not merge the same directory name on two machines', () => {
      const here = projectKey({
        remote: null,
        cwd: '/home/taha/scratch',
        hostname: 'mbp-2',
      }).key
      const there = projectKey({
        remote: null,
        cwd: '/home/taha/scratch',
        hostname: 'ci-runner',
      }).key

      expect(here).not.toBe(there)
    })

    test('carries no raw remote, because there was none', () => {
      expect(
        projectKey({ remote: null, cwd: '/x', hostname: 'h' }).remote,
      ).toBe(null)
    })

    test('folds the Windows drive letter, which one machine spells two ways', () => {
      // Measured: 1,125 entries said `c:\Users\...` and 281 said `C:\Users\...`
      // on one box, same session id, same Claude Code version.
      const lower = projectKey({
        remote: null,
        cwd: 'c:\\Users\\taha\\Documents\\BloxfruitsBot',
        hostname: 'win-box',
      }).key
      const upper = projectKey({
        remote: null,
        cwd: 'C:\\Users\\taha\\Documents\\BloxfruitsBot',
        hostname: 'win-box',
      }).key

      expect(lower).toBe(upper)
    })

    test('leaves case alone where the filesystem respects it', () => {
      const lower = projectKey({
        remote: null,
        cwd: '/home/taha/notes',
        hostname: 'linux-box',
      }).key
      const upper = projectKey({
        remote: null,
        cwd: '/home/taha/Notes',
        hostname: 'linux-box',
      }).key

      expect(lower).not.toBe(upper)
    })

    test('folds a Windows path wherever the key is computed', () => {
      // Ingest and the dashboard compute keys from a stored cwd on a Linux
      // server, so the fold follows the path rather than the running platform.
      expect(
        projectKey({ remote: null, cwd: 'C:/code/App', hostname: 'w' }).key,
      ).toBe(
        projectKey({ remote: null, cwd: 'c:/code/app', hostname: 'w' }).key,
      )
    })
  })

  test('an unreadable remote falls back rather than dropping the work', () => {
    expect(
      projectKey({ remote: 'not a remote', cwd: '/x', hostname: 'h' }).key,
    ).toBe('local:h:/x')
  })
})

describe('the Device key', () => {
  test('is the machine, locally', () => {
    expect(deviceKey({ hostname: 'MBP-2', environment: {} })).toBe('host:mbp-2')
  })

  test('is the account in Claude Code Cloud, never the container', () => {
    // A container lives for an hour; keying on it would fill a dashboard with
    // Devices that no longer exist.
    const first = deviceKey({
      hostname: 'runsc-a1b2c3',
      environment: {
        CLAUDE_CODE_REMOTE: 'true',
        CLAUDE_CODE_ACCOUNT_UUID: '0a1b2c3d-0000-4000-8000-000000000001',
        CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE: 'cloud_default',
        CLAUDE_CODE_CONTAINER_ID: 'container_01R8YBh8CSzaZaNqcKd6jB3k',
      },
    })
    const second = deviceKey({
      hostname: 'runsc-d4e5f6',
      environment: {
        CLAUDE_CODE_REMOTE: 'true',
        CLAUDE_CODE_ACCOUNT_UUID: '0a1b2c3d-0000-4000-8000-000000000001',
        CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE: 'cloud_default',
        CLAUDE_CODE_CONTAINER_ID: 'container_01ZZZZZZZZZZZZZZZZZZZZZZZZ',
      },
    })

    expect(first).toBe('cloud:0a1b2c3d-0000-4000-8000-000000000001')
    expect(second).toBe(first)
  })

  test('names an environment type that is not the default', () => {
    expect(
      deviceKey({
        hostname: 'runsc-a1b2c3',
        environment: {
          CLAUDE_CODE_REMOTE: 'true',
          CLAUDE_CODE_ACCOUNT_UUID: '0a1b2c3d-0000-4000-8000-000000000001',
          CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE: 'cloud_custom',
        },
      }),
    ).toBe('cloud:0a1b2c3d-0000-4000-8000-000000000001:cloud_custom')
  })

  test('falls back to the machine when the cloud names no account', () => {
    // Better a Device per container than a Turn attributed to nothing.
    expect(
      deviceKey({
        hostname: 'runsc-a1b2c3',
        environment: { CLAUDE_CODE_REMOTE: 'true' },
      }),
    ).toBe('host:runsc-a1b2c3')
  })

  test('is the same string for two Members on one machine', () => {
    // Two Members, two Collectors, one shared build box: the key they compute
    // is identical, which is why the Device row is scoped to its Member by the
    // schema rather than by this string.
    expect(
      deviceKey({ hostname: 'build-box', environment: { USER: 'taha' } }),
    ).toBe(deviceKey({ hostname: 'BUILD-BOX', environment: { USER: 'sam' } }))
  })

  test('an explicit override wins, for an account running several environments', () => {
    // The one case neither other rule can see: the account and the machine
    // both look identical across environments that should be counted apart.
    expect(
      deviceKey({
        hostname: 'runsc-a1b2c3',
        environment: {
          SESSCLONE_DEVICE: 'ci-fleet-eu',
          CLAUDE_CODE_REMOTE: 'true',
          CLAUDE_CODE_ACCOUNT_UUID: '0a1b2c3d-0000-4000-8000-000000000001',
        },
      }),
    ).toBe('ci-fleet-eu')
  })

  test('a blank override is not an override', () => {
    // An empty assignment is set-but-empty, which must not defeat the rules
    // below it — the same reason .env.example leaves it commented out.
    expect(
      deviceKey({ hostname: 'mbp-2', environment: { SESSCLONE_DEVICE: '  ' } }),
    ).toBe('host:mbp-2')
  })

  test('an unnamed machine still keys to something stable', () => {
    expect(deviceKey({ hostname: '', environment: {} })).toBe('host:unknown')
  })
})
