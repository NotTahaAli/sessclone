import { describe, expect, test } from 'vitest'

import { deviceKey, projectKey, normaliseRemote } from './identity.ts'

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

  test('a remote it cannot read is not a Project key', () => {
    expect(normaliseRemote('')).toBeNull()
    expect(normaliseRemote('   ')).toBeNull()
    expect(normaliseRemote('not a remote')).toBeNull()
  })
})

describe('the Project key', () => {
  test('is the normalised remote, with the raw one kept for debugging', () => {
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

  test('is the same on two machines that cloned the same repository', () => {
    const laptop = projectKey({
      remote: 'git@github.com:NotTahaAli/sessclone.git',
      cwd: '/Users/taha/Projects/sessclone',
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
      expect(key).not.toBe('notes')
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
        platform: 'win32',
      }).key
      const upper = projectKey({
        remote: null,
        cwd: 'C:\\Users\\taha\\Documents\\BloxfruitsBot',
        hostname: 'win-box',
        platform: 'win32',
      }).key

      expect(lower).toBe(upper)
    })

    test('leaves case alone where the filesystem respects it', () => {
      const lower = projectKey({
        remote: null,
        cwd: '/home/taha/notes',
        hostname: 'linux-box',
        platform: 'linux',
      }).key
      const upper = projectKey({
        remote: null,
        cwd: '/home/taha/Notes',
        hostname: 'linux-box',
        platform: 'linux',
      }).key

      expect(lower).not.toBe(upper)
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
        CLAUDE_CODE_ACCOUNT_UUID: '6c6ec04b-15a2-4eba-915f-ae53ff0e1e8d',
        CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE: 'cloud_default',
        CLAUDE_CODE_CONTAINER_ID: 'container_01R8YBh8CSzaZaNqcKd6jB3k',
      },
    })
    const second = deviceKey({
      hostname: 'runsc-d4e5f6',
      environment: {
        CLAUDE_CODE_REMOTE: 'true',
        CLAUDE_CODE_ACCOUNT_UUID: '6c6ec04b-15a2-4eba-915f-ae53ff0e1e8d',
        CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE: 'cloud_default',
        CLAUDE_CODE_CONTAINER_ID: 'container_01ZZZZZZZZZZZZZZZZZZZZZZZZ',
      },
    })

    expect(first).toBe('cloud:6c6ec04b-15a2-4eba-915f-ae53ff0e1e8d')
    expect(second).toBe(first)
  })

  test('names an environment type that is not the default', () => {
    expect(
      deviceKey({
        hostname: 'runsc-a1b2c3',
        environment: {
          CLAUDE_CODE_REMOTE: 'true',
          CLAUDE_CODE_ACCOUNT_UUID: '6c6ec04b-15a2-4eba-915f-ae53ff0e1e8d',
          CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE: 'cloud_custom',
        },
      }),
    ).toBe('cloud:6c6ec04b-15a2-4eba-915f-ae53ff0e1e8d:cloud_custom')
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
    // Which is why a Device row is scoped to its Member in the schema: the key
    // is unique inside a Member, never globally.
    const shared = { hostname: 'build-box', environment: {} }

    expect(deviceKey(shared)).toBe(deviceKey(shared))
  })

  test('an unnamed machine still keys to something stable', () => {
    expect(deviceKey({ hostname: '', environment: {} })).toBe('host:unknown')
  })
})
