import type { Item, Row } from '@sessclone/shared'

import { field } from './format'

// An artifact publish in a transcript names a local file, never its contents.
// The contents are there only when the same transcript wrote the file with
// Write, so the preview is that Write's text (Taha, 2026-09-23: option B).

export type ArtifactInfo = {
  path: string
  title: string | null
  description: string | null
  url: string | null
}

const text = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value : null

export const artifactInfo = (
  row: Extract<Row, { kind: 'tool' }>,
): ArtifactInfo => {
  const detail = row.result?.detail
  return {
    path: String(field(row.use.input, 'file_path')),
    title: text(field(detail, 'title')) ?? text(field(row.use.input, 'title')),
    description: text(field(row.use.input, 'description')),
    url: text(field(detail, 'url')),
  }
}

export type Written =
  | {
      status: 'found'
      html: string
      /** Edited after it was written. */ stale: boolean
    }
  | { status: 'missing' }

/**
 * What the file at `path` held when it was published at `before`: the last
 * Write of it earlier in the loaded Items. An Edit after that Write means the
 * preview shows an older version, and says so.
 */
export function writtenBefore(
  items: readonly Item[],
  path: string,
  before: number,
): Written {
  let html: string | null = null
  let stale = false
  for (const item of items) {
    if (item.offset >= before) break
    if (item.kind !== 'tool_use') continue
    if (field(item.input, 'file_path') !== path) continue
    if (item.name === 'Write') {
      const content = field(item.input, 'content')
      if (typeof content === 'string') {
        html = content
        stale = false
      }
    } else if (html !== null && /^(Multi)?Edit$/.test(item.name)) {
      stale = true
    }
  }
  return html === null
    ? { status: 'missing' }
    : { status: 'found', html, stale }
}
