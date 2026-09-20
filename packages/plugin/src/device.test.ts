import { describe, expect, it } from 'vitest'

import { deviceKey } from './device.ts'

// The machine key is ticket 30's job; this function only decides whether to
// use it. Every case below passes one in so the two concerns stay apart.
const machine = 'machine:abc123'

describe('deviceKey', () => {
  it('uses the machine key when nothing is configured', () => {
    expect(deviceKey({}, machine)).toEqual({ key: machine, source: 'machine' })
  })

  it('prefers a configured key over the machine key', () => {
    expect(deviceKey({ SESSCLONE_DEVICE: 'laptop' }, machine)).toEqual({
      key: 'laptop',
      source: 'configured',
    })
  })

  it('ignores a set-but-empty variable rather than keying on the empty string', () => {
    expect(deviceKey({ SESSCLONE_DEVICE: '   ' }, machine)).toEqual({
      key: machine,
      source: 'machine',
    })
  })

  // What ticket 30 asks for: a cloud environment keyed by account, not
  // container. Claude Code supplies the account itself, so the common case
  // needs no configuration at all.
  it('keys an unconfigured cloud environment on the account', () => {
    expect(
      deviceKey(
        {
          CLAUDE_CODE_REMOTE: 'true',
          CLAUDE_CODE_ACCOUNT_UUID: '00000000-0000-4000-8000-000000000000',
        },
        machine,
      ),
    ).toEqual({
      key: 'account:00000000-0000-4000-8000-000000000000',
      source: 'account',
    })
  })

  it('is the same Device in a second container on the same account', () => {
    const env = {
      CLAUDE_CODE_REMOTE: 'true',
      CLAUDE_CODE_ACCOUNT_UUID: '00000000-0000-4000-8000-000000000000',
    }

    expect(deviceKey(env, 'machine:container-two')).toEqual(
      deviceKey(env, 'machine:container-one'),
    )
  })

  // The fallback of the fallback. A cloud container's machine key is minted
  // fresh on every boot, so using it is a guess. It is still the answer — a
  // Device we cannot name is worse than one that churns — but the source says
  // so, and ingest can tell the two apart.
  it('marks a cloud environment with no account as container-keyed', () => {
    expect(deviceKey({ CLAUDE_CODE_REMOTE: 'true' }, machine)).toEqual({
      key: machine,
      source: 'container',
    })
  })

  it('prefers a configured key over the account', () => {
    expect(
      deviceKey(
        {
          CLAUDE_CODE_REMOTE: 'true',
          CLAUDE_CODE_ACCOUNT_UUID: '00000000-0000-4000-8000-000000000000',
          SESSCLONE_DEVICE: 'projects-sessclone',
        },
        machine,
      ),
    ).toEqual({ key: 'projects-sessclone', source: 'configured' })
  })
})
