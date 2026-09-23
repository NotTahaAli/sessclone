import { z } from 'zod'

import { splitChunk, parseLines, type Item } from '@sessclone/shared'

// Tickets 102-104: how the viewer's browser reaches the bytes. The file list
// comes from our route; the bytes come straight from storage through the
// presigned links it hands out (ADR 0003), never through the application.

const StoredFile = z.object({
  id: z.string(),
  kind: z.enum(['transcript', 'agent_meta', 'workflow_journal']),
  /** Null for the Session itself; the runId for a workflow journal. */
  agentId: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative(),
  uploadedAt: z.string(),
  url: z.string(),
  expiresIn: z.number(),
})
export type StoredFile = z.infer<typeof StoredFile>
const Files = z.object({ files: z.array(StoredFile) })

/** What `GET /api/transcripts/<id>` said, in the viewer's terms. */
export type FileList =
  | { status: 'ready'; files: StoredFile[] }
  | { status: 'missing' }
  | { status: 'error'; message: string }

export const listFiles = async (
  sessionId: string,
  signal?: AbortSignal,
): Promise<FileList> => {
  const response = await fetch(
    `/api/transcripts/${encodeURIComponent(sessionId)}`,
    { signal, cache: 'no-store' },
  )
  if (response.status === 404) return { status: 'missing' }
  if (!response.ok) {
    return {
      status: 'error',
      message: (await response.text()) || 'The file list did not load.',
    }
  }
  const body = Files.safeParse(await response.json())
  return body.success
    ? { status: 'ready', files: body.data.files }
    : {
        status: 'error',
        message: 'The file list was not in a shape this page reads.',
      }
}

/**
 * Bytes of one stored file, `range` inclusive, or the whole file without one.
 * The links expire after a few minutes, and a storage refusal of an expired
 * link is a 403: `renew` fetches a fresh list once and the read is retried on
 * the new link. A server that ignores Range answers 200 with everything, which
 * `whole` reports so the caller can treat it as the whole file.
 */
export const readBytes = async (
  file: StoredFile,
  range: { start: number; end: number } | null,
  renew: () => Promise<StoredFile | null>,
  signal?: AbortSignal,
): Promise<{ bytes: Uint8Array; whole: boolean }> => {
  const get = (url: string) =>
    fetch(url, {
      signal,
      headers: range ? { Range: `bytes=${range.start}-${range.end}` } : {},
    })
  let response = await get(file.url)
  if (response.status === 403) {
    const fresh = await renew()
    if (fresh) response = await get(fresh.url)
  }
  if (!response.ok) {
    throw new Error(
      response.status === 403
        ? 'Storage refused the link, even a fresh one.'
        : `Storage answered ${response.status}.`,
    )
  }
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    whole: !range || response.status === 200,
  }
}

/** A whole small file — an agent's transcript — as Items. */
export const readItems = async (
  file: StoredFile,
  renew: () => Promise<StoredFile | null>,
  signal?: AbortSignal,
): Promise<Item[]> => {
  const { bytes } = await readBytes(file, null, renew, signal)
  return parseLines(
    splitChunk(bytes, 0, { atFileStart: true, atFileEnd: true }).lines,
  )
}

export const readText = async (
  file: StoredFile,
  renew: () => Promise<StoredFile | null>,
  signal?: AbortSignal,
) =>
  new TextDecoder().decode((await readBytes(file, null, renew, signal)).bytes)

export const concat = (a: Uint8Array, b: Uint8Array) => {
  if (b.length === 0) return a
  const out = new Uint8Array(a.length + b.length)
  out.set(a)
  out.set(b, a.length)
  return out
}

/** Per-message cost, keyed `<agentId or ''>:<messageId>` as the route keys it. */
const TurnCost = z.object({
  costUsd: z.number().nullable(),
  model: z.string().nullable(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
})
export type TurnCost = z.infer<typeof TurnCost>
const Costs = z.record(z.string(), TurnCost)

export const readCosts = async (
  sessionId: string,
  signal?: AbortSignal,
): Promise<Record<string, TurnCost>> => {
  const response = await fetch(
    `/api/transcripts/${encodeURIComponent(sessionId)}/costs`,
    { cache: 'no-store', signal },
  )
  if (!response.ok) throw new Error('Costs did not load.')
  return Costs.parse(await response.json())
}
