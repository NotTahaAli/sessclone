import { afterEach, expect, test, vi } from 'vitest'

import { debugFailure } from './debug.mjs'

afterEach(() => {
  vi.restoreAllMocks()
})

const spyStderr = () =>
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

test('writes nothing unless SESSCLONE_DEBUG is set', () => {
  const write = spyStderr()
  debugFailure('stop hook', new Error('boom'), {})
  debugFailure('stop hook', new Error('boom'), { SESSCLONE_DEBUG: '' })
  expect(write).not.toHaveBeenCalled()
})

test('writes one line naming the hook and the error', () => {
  const write = spyStderr()
  debugFailure('stop hook', new Error('boom'), { SESSCLONE_DEBUG: '1' })
  expect(write).toHaveBeenCalledTimes(1)
  expect(write).toHaveBeenCalledWith(
    'sessclone: stop hook failed: Error: boom\n',
  )
})

test('a thrown non-Error still writes one line', () => {
  const write = spyStderr()
  debugFailure('flush', 'plain string', { SESSCLONE_DEBUG: '1' })
  expect(write).toHaveBeenCalledTimes(1)
  expect(write).toHaveBeenCalledWith('sessclone: flush failed: plain string\n')
})
