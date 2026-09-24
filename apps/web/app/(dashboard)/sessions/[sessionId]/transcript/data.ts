import { z } from 'zod'

import { splitChunk, parseLines, type Item } from '@sessclone/shared'

import type { Read } from './columns'

// Tickets 105-107: how the viewer's browser reaches the bytes. The file list
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
  /**
   * ADR 0008: the raw offset the object at `url` starts at. Zero, with no
   * chunks, for a whole-file transcript and every sidecar.
   */
  tailOffset: z.number().int().nonnegative().default(0),
  /** The sealed gzip chunks before the tail, in order. */
  chunks: z
    .array(
      z.object({
        rawOffset: z.number().int().nonnegative(),
        rawLength: z.number().int().positive(),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
        url: z.string(),
      }),
    )
    .default([]),
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
  memberId: string,
  signal?: AbortSignal,
): Promise<FileList> => {
  const response = await fetch(
    `/api/transcripts/${encodeURIComponent(sessionId)}?member=${encodeURIComponent(memberId)}`,
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

const RELOAD =
  'This transcript was archived further since it opened. Reload to read it.'

/**
 * One GET, renewed once on a refusal. The links expire after a few minutes,
 * and a storage refusal of an expired link is a 403: `fresh` fetches a new
 * link once and the read is retried on it.
 */
const getRenewing = async (
  url: string,
  fresh: () => Promise<string | null>,
  init: RequestInit,
) => {
  const get = (link: string) => fetch(link, init)
  // R2 answers an expired link's 403 without CORS headers, so the browser
  // reports a network error rather than the status: treat that like a 403.
  // An abort is the caller's own doing and is not retried.
  let response = await get(url).catch((error: unknown) => {
    if (error instanceof TypeError) return null
    throw error
  })
  if (!response || response.status === 403) {
    const link = await fresh()
    if (link) response = await get(link)
  }
  if (!response) throw new Error('Storage could not be reached.')
  if (!response.ok) {
    throw new Error(
      response.status === 403
        ? 'Storage refused the link, even a fresh one.'
        : `Storage answered ${response.status}.`,
    )
  }
  return response
}

/**
 * Bytes of one stored object, `range` inclusive and counted inside the object
 * (so from `tailOffset` for a chunked transcript), or the whole object without
 * one. A server that ignores Range answers 200 with everything, which `whole`
 * reports so the caller can treat it as the whole object.
 *
 * A renewed link must name the same tail: once a transcript seals more chunks
 * its tail moves to a new key that starts at a new offset, and reading it at
 * the old offsets would repeat or skip bytes.
 */
export const readBytes = async (
  file: StoredFile,
  range: { start: number; end: number } | null,
  renew: () => Promise<StoredFile | null>,
  signal?: AbortSignal,
): Promise<{ bytes: Uint8Array; whole: boolean }> => {
  const response = await getRenewing(
    file.url,
    async () => {
      const fresh = await renew()
      if (fresh && fresh.tailOffset !== file.tailOffset) throw new Error(RELOAD)
      return fresh?.url ?? null
    },
    {
      signal,
      headers: range ? { Range: `bytes=${range.start}-${range.end}` } : {},
    },
  )
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    whole: !range || response.status === 200,
  }
}

const hex = async (bytes: Uint8Array<ArrayBuffer>) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('')

/**
 * One sealed chunk (ADR 0008), fetched whole, gunzipped, and checked against
 * its raw SHA-256: a mismatch throws, so neither the viewer nor a download
 * ever shows or saves a corrupt chunk. Chunks are stored as `application/gzip`
 * with no Content-Encoding, so the browser hands over the gzip bytes as they
 * are. A chunk is immutable; a renewed list must still hold this one.
 */
export const readChunk = async (
  file: StoredFile,
  index: number,
  renew: () => Promise<StoredFile | null>,
  signal?: AbortSignal,
): Promise<Uint8Array> => {
  const chunk = file.chunks[index]
  if (!chunk) throw new Error(RELOAD)
  const response = await getRenewing(
    chunk.url,
    async () => {
      const fresh = await renew()
      const same = fresh?.chunks.find(
        (one) =>
          one.rawOffset === chunk.rawOffset && one.sha256 === chunk.sha256,
      )
      if (fresh && !same) throw new Error(RELOAD)
      return same?.url ?? null
    },
    { signal },
  )
  if (!response.body) throw new Error('Storage sent an empty chunk.')
  const bytes = new Uint8Array(
    await new Response(
      response.body.pipeThrough(new DecompressionStream('gzip')),
    ).arrayBuffer(),
  )
  if ((await hex(bytes)) !== chunk.sha256) {
    throw new Error('A chunk of this transcript failed its checksum.')
  }
  return bytes
}

/**
 * The raw bytes `columns.earlierRead` planned, with the raw offset they start
 * at: a Range read inside the tail, or one chunk cut where the loaded bytes
 * begin. A server that ignored Range sent the whole tail, which is kept up to
 * the end of the read, so the caller loads more than it asked and nothing
 * twice.
 */
export const readRaw = async (
  file: StoredFile,
  read: Read,
  renew: () => Promise<StoredFile | null>,
  signal?: AbortSignal,
): Promise<{ bytes: Uint8Array; start: number }> => {
  if (read.kind === 'chunk') {
    const offset = file.chunks[read.index]?.rawOffset ?? 0
    const bytes = await readChunk(file, read.index, renew, signal)
    return {
      bytes: bytes.subarray(read.start - offset, read.end - offset + 1),
      start: read.start,
    }
  }
  const at = file.tailOffset
  const { bytes, whole } = await readBytes(
    file,
    { start: read.start - at, end: read.end - at },
    renew,
    signal,
  )
  return whole
    ? { bytes: bytes.subarray(0, read.end - at + 1), start: at }
    : { bytes, start: read.start }
}

/**
 * The whole raw transcript as one stream: each chunk in order, gunzipped and
 * checked, then the tail (tickets 132 and 133). A whole-file row is its one
 * object. Pulled a chunk at a time, so a reader that writes as it goes holds
 * about a chunk in memory.
 */
export const wholeStream = (
  file: StoredFile,
  renew: () => Promise<StoredFile | null>,
  signal?: AbortSignal,
) => {
  let next = 0
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (next < file.chunks.length) {
        controller.enqueue(await readChunk(file, next++, renew, signal))
        return
      }
      controller.enqueue((await readBytes(file, null, renew, signal)).bytes)
      controller.close()
    },
  })
}

/** A whole small file — an agent's transcript — as Items. */
export const readItems = async (
  file: StoredFile,
  renew: () => Promise<StoredFile | null>,
  signal?: AbortSignal,
): Promise<Item[]> => {
  const bytes = new Uint8Array(
    await new Response(wholeStream(file, renew, signal)).arrayBuffer(),
  )
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
  memberId: string,
  signal?: AbortSignal,
): Promise<Record<string, TurnCost>> => {
  const response = await fetch(
    `/api/transcripts/${encodeURIComponent(sessionId)}/costs?member=${encodeURIComponent(memberId)}`,
    { cache: 'no-store', signal },
  )
  if (!response.ok) throw new Error('Costs did not load.')
  return Costs.parse(await response.json())
}
