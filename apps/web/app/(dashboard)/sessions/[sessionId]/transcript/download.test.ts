import { expect, test } from 'vitest'

import { downloadName, saveMethod } from './download'

test('a browser with the save picker streams to disk; any other builds a Blob', () => {
  expect(saveMethod({ showSaveFilePicker: async () => ({}) })).toBe('picker')
  expect(saveMethod({})).toBe('blob')
  expect(saveMethod({ showSaveFilePicker: 'not a function' })).toBe('blob')
})

test('the file is named as the 302 download names it', () => {
  expect(downloadName('s-1', null)).toBe('s-1.jsonl')
  expect(downloadName('s-1', 'a-7')).toBe('s-1-agent-a-7.jsonl')
})
