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

  // The whole point of the ticket: a cloud container's machine key is minted
  // fresh on every boot, so using it is a guess. It is still the answer — a
  // Device we cannot name is worse than one that churns — but the source says
  // so, and ingest can tell the two apart.
  it('marks an unconfigured cloud environment as container-keyed', () => {
    expect(deviceKey({ CLAUDE_CODE_REMOTE: 'true' }, machine)).toEqual({
      key: machine,
      source: 'container',
    })
  })

  it('is the same Device in a second container with the same configuration', () => {
    const first = deviceKey(
      { CLAUDE_CODE_REMOTE: 'true', SESSCLONE_DEVICE: 'env_01U4gtc7' },
      'machine:container-one',
    )
    const second = deviceKey(
      { CLAUDE_CODE_REMOTE: 'true', SESSCLONE_DEVICE: 'env_01U4gtc7' },
      'machine:container-two',
    )
    expect(second).toEqual(first)
  })
})
