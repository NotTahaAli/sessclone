import { expect, test } from 'vitest'

import { capped, downloadName, saveMethod } from './download'

test('a browser with the save picker streams to disk; any other builds a Blob', () => {
  expect(saveMethod({ showSaveFilePicker: async () => ({}) })).toBe('picker')
  expect(saveMethod({})).toBe('blob')
  expect(saveMethod({ showSaveFilePicker: 'not a function' })).toBe('blob')
})

test('the file is named as the 302 download names it', () => {
  expect(downloadName('s-1', null)).toBe('s-1.jsonl')
  expect(downloadName('s-1', 'a-7')).toBe('s-1-agent-a-7.jsonl')
})

const bytes = (...sizes: number[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const size of sizes) controller.enqueue(new Uint8Array(size))
      controller.close()
    },
  })

test('the Blob path passes a transcript up to its cap through unchanged', async () => {
  const blob = await new Response(capped(bytes(4, 4), 8)).blob()
  expect(blob.size).toBe(8)
})

test('the Blob path refuses a transcript past its cap before holding it all', async () => {
  await expect(new Response(capped(bytes(4, 4, 1), 8)).blob()).rejects.toThrow(
    /too large to assemble in this browser/,
  )
})
