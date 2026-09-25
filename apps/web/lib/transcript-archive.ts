import { createHash } from 'node:crypto'

import type { TransactionSql } from 'postgres'
import { z } from 'zod'

import { chunkedSql } from './artifacts'
import { objectStream } from './storage'
import type { ZipEntry } from './zip'

// Ticket 140: every transcript the viewer can already download one at a time,
// as one zip with a folder per person and per Project.
//
// No Role is named here, exactly as for the single download (ticket 60):
// `log_artifacts_read` is `sessclone_visible_member_ids()`, so an Owner and an
// Admin read the whole Org, a Manager their Scope and a Member their own, and
// the statement below asks for that same set. A filter can only narrow it: a
// hand-typed Member id outside it matches no row, as it would on the page.

/**
 * Past this many transcripts the route refuses and asks for narrower filters.
 * Not a format limit (the zip goes ZIP64 as it needs to) but a time one: the
 * whole zip has to stream inside one function's `maxDuration`, and each
 * transcript costs a storage round trip or two, one after another.
 * ponytail: fetching the next object while this one streams would raise it.
 */
export const ARCHIVE_ENTRIES = 2000
/**
 * Past this many raw bytes, likewise. Deflating runs near 190 MB/s here, so
 * the bound is the client's download of what is left, several times smaller.
 */
export const ARCHIVE_BYTES = 8 * 1024 ** 3

const one = (value: string | null) => value || undefined
const Day = z.iso.date()

/**
 * The query string the Transcripts page's form sends. Everything optional; a
 * list left empty is "all of them". `none` is the Sessions outside a
 * repository, the spelling the page uses everywhere.
 */
export const ArchiveFilter = z.object({
  from: Day.optional(),
  to: Day.optional(),
  members: z.array(z.uuid()).max(500),
  projects: z.array(z.union([z.uuid(), z.literal('none')])).max(500),
  devices: z.array(z.uuid()).max(500),
})
export type ArchiveFilter = z.infer<typeof ArchiveFilter>

export const parseArchiveFilter = (search: URLSearchParams) =>
  ArchiveFilter.safeParse({
    from: one(search.get('from')),
    to: one(search.get('to')),
    members: search.getAll('member'),
    projects: search.getAll('project'),
    devices: search.getAll('device'),
  })

export type ArchiveItem = {
  memberId: string
  person: string
  project: string | null
  sessionId: string
  agentId: string | null
  uploadedAt: Date
  /** The transcript's last Turn, or its last upload when it has none. */
  endedAt: Date
  sizeBytes: number
  storageKey: string
  /** ADR 0008: the gzip chunks before the tail at `storageKey`, in order. */
  chunks: { storageKey: string; sha256: string }[]
}

/**
 * The transcripts a zip holds, in one statement with each one's chunks
 * aggregated beside it (as `transcriptFiles` does), capped at `limit + 1` so
 * the caller can tell a full archive from a refused one.
 */
export const archiveList = async (
  tx: TransactionSql,
  {
    orgId,
    timezone,
    filter,
    limit = ARCHIVE_ENTRIES,
  }: {
    orgId: string
    timezone: string
    filter: ArchiveFilter
    limit?: number
  },
): Promise<ArchiveItem[]> => {
  const projectIds = filter.projects.filter((id) => id !== 'none')
  const outside = filter.projects.includes('none')
  const rows = await tx<
    {
      member_id: string
      person: string
      project: string | null
      session_id: string
      agent_id: string | null
      uploaded_at: Date
      ended_at: Date
      size_bytes: string
      storage_key: string
      chunks: { storageKey: string; sha256: string }[]
    }[]
  >`
    select artifact.member_id, artifact.session_id, artifact.agent_id,
           artifact.uploaded_at, artifact.size_bytes, artifact.storage_key,
           coalesce(span.ended_at, artifact.uploaded_at) as ended_at,
           coalesce(person.email, artifact.member_id::text) as person,
           coalesce(project.nickname, project.key) as project,
           case when test.chunked then coalesce(chunk.list, '[]') else '[]' end
             as chunks
      from log_artifacts artifact
      left join projects project on project.id = artifact.project_id
      left join members member on member.id = artifact.member_id
      left join users person on person.id = member.user_id
      cross join lateral (select ${chunkedSql(tx, 'artifact')} as chunked) test
      -- Its first and last Turn and its Devices, read past the history
      -- window: a stored transcript is downloadable whatever its age.
      cross join lateral sessclone_transcript_span(
        artifact.member_id, artifact.session_id, artifact.agent_id) span
      left join lateral (
        select json_agg(json_build_object(
                 'storageKey', storage_key, 'sha256', sha256
               ) order by seq) as list
          from log_artifact_chunks
         where artifact_id = artifact.id
      ) chunk on true
     where artifact.member_id in (select sessclone_visible_member_ids())
       and artifact.org_id = ${orgId}
       and artifact.kind = 'transcript'
       ${
         // Calendar days in the Org's timezone, `to` counted, as the Costs
         // range reads them. A transcript whose span, first Turn to last,
         // touches the range is in, whole. One with no Turns spans its
         // upload time.
         filter.from
           ? tx`and coalesce(span.ended_at, artifact.uploaded_at)
                    >= (${filter.from}::date)::timestamp at time zone ${timezone}`
           : tx``
       }
       ${
         filter.to
           ? tx`and coalesce(span.started_at, artifact.uploaded_at)
                    < (${filter.to}::date + 1)::timestamp at time zone ${timezone}`
           : tx``
       }
       ${
         filter.members.length
           ? tx`and artifact.member_id = any(${filter.members}::uuid[])`
           : tx``
       }
       ${
         filter.projects.length
           ? tx`and (artifact.project_id = any(${projectIds}::uuid[])
                     ${outside ? tx`or artifact.project_id is null` : tx``})`
           : tx``
       }
       ${
         // A transcript has no Device of its own; its Session's Turns do.
         filter.devices.length
           ? tx`and span.device_ids && ${filter.devices}::uuid[]`
           : tx``
       }
     order by person, project nulls last, artifact.uploaded_at desc,
              artifact.id
     limit ${limit + 1}
  `
  return rows.map((row) => ({
    memberId: row.member_id,
    person: row.person,
    project: row.project,
    sessionId: row.session_id,
    agentId: row.agent_id,
    uploadedAt: row.uploaded_at,
    endedAt: row.ended_at,
    sizeBytes: Number(row.size_bytes),
    storageKey: row.storage_key,
    chunks: row.chunks,
  }))
}

/**
 * One path segment of a name a Collector or a person chose: no separator, no
 * control or formatting character, no leading dot, so nothing escapes its
 * folder when the zip is unpacked.
 */
const segment = (raw: string) =>
  raw
    .replaceAll(/[/\\:*?"<>|\p{C}]+/gu, '-')
    .replace(/^[.\s-]+/, '')
    .slice(0, 120) || 'unnamed'

/** `<person>/<project>/<session>[-agent-<id>].jsonl`, unique in the archive. */
export const archivePaths = (items: ArchiveItem[]) => {
  const taken = new Set<string>()
  return items.map((item) => {
    const base = [
      segment(item.person),
      item.project === null ? 'outside-a-repository' : segment(item.project),
      segment(
        item.agentId
          ? `${item.sessionId}-agent-${item.agentId}`
          : item.sessionId,
      ),
    ].join('/')
    // Two names can clean alike; the second gets a number rather than
    // overwriting the first when unpacked.
    let path = `${base}.jsonl`
    for (let n = 2; taken.has(path); n += 1) path = `${base}-${n}.jsonl`
    taken.add(path)
    return path
  })
}

async function* read(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  try {
    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- a stream is read in order.
      const next = await reader.read()
      if (next.done) return
      yield next.value
    }
  } finally {
    // Early exit (the client left): let storage go rather than drain it.
    await reader.cancel().catch(() => {})
  }
}

const missing = (key: string) => new Error(`${key} is no longer stored`)

/** One sealed chunk, gunzipped and checked against its raw SHA-256. */
async function* chunk(
  { storageKey, sha256 }: { storageKey: string; sha256: string },
  opened: ReadableStream<Uint8Array<ArrayBuffer>> | null,
  signal: AbortSignal,
) {
  const stream = opened ?? (await objectStream(storageKey, signal))
  if (!stream) throw missing(storageKey)
  const hash = createHash('sha256')
  for await (const piece of read(
    stream.pipeThrough(new DecompressionStream('gzip')),
  )) {
    hash.update(piece)
    yield piece
  }
  // Too late to take the bytes back, so the archive fails instead: a zip
  // that errors is one a person retries, a corrupt one is kept.
  if (hash.digest('hex') !== sha256) {
    throw new Error(`${storageKey} failed its checksum`)
  }
}

/**
 * The zip's entries, each opened as it is reached rather than all at once.
 *
 * A transcript whose first object is already gone — deleted, or swept by
 * retention since the list was read — is left out rather than failing the
 * zip. ponytail: one whose tail is re-sealed while its chunks stream fails
 * the zip (the old tail is deleted); re-reading the row and continuing from
 * the new chunks would save it, if live Sessions make that common.
 */
export async function* archiveEntries(
  items: ArchiveItem[],
  signal: AbortSignal,
): AsyncGenerator<ZipEntry> {
  const paths = archivePaths(items)
  for (const [index, item] of items.entries()) {
    if (signal.aborted) return
    const [first] = item.chunks
    // oxlint-disable-next-line no-await-in-loop -- one entry at a time, in order.
    const opened = await objectStream(
      first?.storageKey ?? item.storageKey,
      signal,
    )
    if (!opened) continue

    // A body only closes its stream once read. Stopped before that (the
    // client left while the entry's header went out), the stream is closed
    // here, or it holds a storage socket until it times out.
    let started = false
    try {
      yield {
        name: paths[index]!,
        modified: item.endedAt,
        body: (async function* () {
          started = true
          for (const [at, sealed] of item.chunks.entries()) {
            yield* chunk(sealed, at === 0 ? opened : null, signal)
          }
          const tail =
            first === undefined
              ? opened
              : await objectStream(item.storageKey, signal)
          if (!tail) throw missing(item.storageKey)
          yield* read(tail)
        })(),
      }
    } finally {
      // oxlint-disable-next-line no-await-in-loop -- this entry's own stream.
      if (!started) await opened.cancel().catch(() => {})
    }
  }
}

export type ArchiveChoices = {
  people: { id: string; name: string }[]
  projects: { id: string; name: string }[]
  devices: { id: string; name: string; person: string }[]
}

/** Each list is bounded; the form says so when one is cut. */
export const CHOICE_LIMIT = 200

/**
 * What the form offers: the people, Projects and Devices of the visible
 * Members in this Org, under the same policies the zip is read under. Projects
 * are the ones with a transcript the viewer could download, not every Project
 * the Org has seen.
 */
export const archiveChoices = async (
  tx: TransactionSql,
  orgId: string,
): Promise<ArchiveChoices> => {
  const [people, projects, devices] = await Promise.all([
    tx<{ id: string; name: string }[]>`
      select member.id, coalesce(account.display_name, account.email) as name
        from members member
        join users account on account.id = member.user_id
       where member.org_id = ${orgId}
         and member.id in (select sessclone_visible_member_ids())
       order by 2
       limit ${CHOICE_LIMIT}
    `,
    tx<{ id: string; name: string }[]>`
      select project.id, coalesce(project.nickname, project.key) as name
        from projects project
       where project.org_id = ${orgId}
         and project.id in (
           select project_id from log_artifacts
            where org_id = ${orgId}
              and kind = 'transcript'
              and member_id in (select sessclone_visible_member_ids()))
       order by 2
       limit ${CHOICE_LIMIT}
    `,
    tx<{ id: string; name: string; person: string }[]>`
      select device.id, coalesce(device.nickname, device.key) as name,
             coalesce(account.display_name, account.email) as person
        from devices device
        join members member on member.id = device.member_id
        join users account on account.id = member.user_id
       where member.org_id = ${orgId}
         and device.member_id in (select sessclone_visible_member_ids())
       order by device.last_seen_at desc
       limit ${CHOICE_LIMIT}
    `,
  ])
  return { people, projects, devices }
}
