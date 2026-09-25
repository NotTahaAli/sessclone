import { createHash } from 'node:crypto'

import type postgres from 'postgres'

import { DEMO_EMAIL, DEMO_USER_ID } from './demo'
import {
  DEMO_ORGS,
  VISITOR_NAME,
  demoCutoff,
  demoDay,
  demoOrg,
  demoTranscript,
  demoWindow,
  type DemoOrg,
} from './demo-data'
import { artifactKey, deleteObjects, presignUpload } from './storage'

// Ticket 137: the daily job that keeps the demo fresh.
//
// Idempotent, so the first call is the backfill and every later one is the
// day's top-up: it creates the demo Orgs, people, Projects and Devices when
// missing, deletes demo data older than the window (rows and the transcript
// objects they name), and seeds every day in the window that has no Turns.
// A day seeded twice is the same rows (`demo-data.ts` is deterministic), and
// every insert ignores a row that is already there.
//
// It runs as the owning role, like ingest and the retention sweep: `turns`
// has no insert policy by design, and the rows belong to no viewer.

/** Where transcript objects go; null when the deployment has no storage,
 * and then the demo simply has no transcripts. */
export type DemoStore = {
  put: (key: string, body: string) => Promise<void>
  remove: (keys: string[]) => Promise<void>
}

/** The server's own upload: presigned like a Collector's (ADR 0003), so no
 * second storage code path exists. The objects are a few kilobytes each. */
export const presignedStore: DemoStore = {
  put: async (key, body) => {
    const response = await fetch(await presignUpload(key), {
      method: 'PUT',
      headers: { 'content-type': 'application/x-ndjson' },
      body,
      // A stalled PUT fails the refresh (rolled back) rather than hanging it.
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error(`storage refused ${response.status}`)
  },
  remove: deleteObjects,
}

export type Refreshed = {
  /** (Org, day) pairs seeded by this call. */
  seeded: number
  /** Turns deleted for being older than the window. */
  pruned: number
  /** Transcript objects written. */
  transcripts: number
}

/** Rows per insert: well under Postgres' 65,535 parameters at 18 columns. */
const BATCH = 2_000

/** More new Turns than a day's top-up: a backfill. */
const ANALYZE_AFTER = 10_000

const orgs = () => DEMO_ORGS.map((spec) => demoOrg(spec, DEMO_USER_ID))

const inBatches = async <T>(
  rows: T[],
  write: (batch: T[]) => Promise<unknown>,
) => {
  for (let from = 0; from < rows.length; from += BATCH) {
    // Bounded batches of one statement each, not a query per row.
    // oxlint-disable-next-line no-await-in-loop -- one transaction, in order.
    await write(rows.slice(from, from + BATCH))
  }
}

/** The demo Orgs and everybody in them, created when missing. */
export const ensureDemo = async (
  tx: postgres.TransactionSql,
  all: DemoOrg[] = orgs(),
) => {
  // The Team Tier: six seats, and the demo is a team. Any published Tier
  // otherwise, so a deployment that renamed its Tiers still gets a demo.
  const [tier] = await tx<{ id: string }[]>`
    select id from tiers order by (key = 'team') desc, sort_order limit 1
  `
  if (!tier) throw new Error('the demo needs at least one Tier')

  await tx`
    insert into orgs ${tx(
      all.map((org) => ({
        id: org.id,
        name: org.spec.name,
        is_demo: true,
        created_at: org.spec.createdAt,
        retention_days: 60,
      })),
    )} on conflict do nothing
  `
  const people = new Map<
    string,
    { id: string; email: string; display_name: string }
  >()
  people.set(DEMO_USER_ID, {
    id: DEMO_USER_ID,
    email: DEMO_EMAIL,
    display_name: VISITOR_NAME,
  })
  for (const person of all.flatMap((org) => org.team)) {
    if (!person.visitor) {
      people.set(person.userId, {
        id: person.userId,
        email: person.email,
        display_name: person.name,
      })
    }
  }
  await tx`insert into users ${tx([...people.values()])} on conflict do nothing`
  await tx`
    insert into members ${tx(
      all.flatMap((org) =>
        org.team.map((person) => ({
          id: person.memberId,
          org_id: org.id,
          user_id: person.userId,
          role: person.role,
          created_at: org.spec.createdAt,
        })),
      ),
    )} on conflict do nothing
  `
  // The visitor keeps transcripts; nobody else's are stored. Archival is the
  // Member's own switch, which the column guard enforces even for the owning
  // role, so it is thrown as the visitor, for this transaction only.
  await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: DEMO_USER_ID })}, true)`
  await tx`
    update members set archival_enabled = true
     where user_id = ${DEMO_USER_ID} and not archival_enabled
  `
  await tx`select set_config('request.jwt.claims', '', true)`
  await tx`
    insert into subscriptions ${tx(
      all.map((org) => ({
        org_id: org.id,
        tier_id: tier.id,
        status: 'active',
      })),
    )} on conflict do nothing
  `
  await tx`
    insert into projects ${tx(
      all.flatMap((org) =>
        org.projects.map((project) => ({
          id: project.id,
          org_id: org.id,
          key: project.key,
          remote: `https://${project.key}.git`,
        })),
      ),
    )} on conflict do nothing
  `
  await tx`
    insert into devices ${tx(
      all.flatMap((org) =>
        org.team.flatMap((person) =>
          person.devices.map((device) => ({
            id: device.id,
            member_id: person.memberId,
            key: device.key,
            nickname: device.nickname,
          })),
        ),
      ),
    )} on conflict do nothing
  `
}

/**
 * Brings the demo up to date at `now`. `store` null seeds no transcripts
 * (and removes none), for a deployment without storage.
 */
export const refreshDemo = async (
  sql: postgres.Sql,
  store: DemoStore | null,
  now = new Date(),
): Promise<Refreshed | null> =>
  sql.begin(async (tx) => {
    // One refresh at a time: a second caller comes back later rather than
    // seeding the same days beside the first.
    const [held] = await tx<{ granted: boolean }[]>`
      select pg_try_advisory_xact_lock(hashtext('sessclone_demo_refresh'))
             as granted
    `
    if (!held?.granted) return null

    // Bounded: a hung statement or a stalled storage PUT between statements
    // must not hold the lock and the rows open until the platform kills the
    // function. A backfill's statements take seconds, a PUT at most 10.
    await tx`set local statement_timeout = '60s'`
    await tx`set local idle_in_transaction_session_timeout = '60s'`

    const all = orgs()
    await ensureDemo(tx, all)

    // Every delete below names these ids, so they are read back with the
    // flag rather than trusted from the generator: an id that is somehow a
    // real Org's (`on conflict do nothing` would leave it untouched) stops
    // the refresh before anything of theirs is pruned.
    const ids = (
      await tx<{ id: string }[]>`
        select id from orgs
         where id = any(${all.map((org) => org.id)}::uuid[]) and is_demo
      `
    ).map((row) => row.id)
    if (ids.length !== all.length) {
      throw new Error('a demo Org id belongs to an Org that is not a demo')
    }

    // Prune. Transcripts first: their rows and objects go together, and the
    // objects are deleted before this commits, as the retention sweep does,
    // so a storage failure rolls the rows back rather than orphaning bytes.
    const cutoff = demoCutoff(now)
    const doomed = await tx<{ storage_key: string }[]>`
      with old as (
        select id from log_artifacts
         where org_id = any(${ids}::uuid[]) and created_at < ${cutoff}
      ), chunks as (
        delete from log_artifact_chunks where artifact_id in (select id from old)
        returning storage_key
      ), artifacts as (
        delete from log_artifacts where id in (select id from old)
        returning storage_key
      )
      select storage_key from artifacts
      union all select storage_key from chunks
    `
    await tx`
      delete from session_events
       where org_id = any(${ids}::uuid[]) and occurred_at < ${cutoff}
    `
    const pruned = await tx`
      delete from turns
       where org_id = any(${ids}::uuid[]) and occurred_at < ${cutoff}
    `

    // Seed every day of the window with no Turns yet, per Org. One indexed
    // read (`turns_org_occurred_at_idx`) for both Orgs.
    const present = await tx<{ org_id: string; day: string }[]>`
      select distinct org_id, to_char(occurred_at at time zone 'UTC', 'YYYY-MM-DD') as day
        from turns
       where org_id = any(${ids}::uuid[]) and occurred_at >= ${cutoff}
    `
    const have = new Set(present.map((row) => `${row.org_id}:${row.day}`))
    const window = demoWindow(now)

    const turns: Record<string, unknown>[] = []
    const events: Record<string, unknown>[] = []
    const artifacts: Record<string, unknown>[] = []
    const objects: { key: string; body: string }[] = []
    let seeded = 0

    for (const org of all) {
      for (const day of window) {
        if (have.has(`${org.id}:${day}`)) continue
        seeded++
        for (const session of demoDay(org, day)) {
          const shared = {
            org_id: org.id,
            member_id: session.memberId,
            device_id: session.deviceId,
            session_id: session.sessionId,
          }
          for (const turn of session.turns) {
            turns.push({
              ...shared,
              project_id: session.projectId,
              agent_id: turn.agentId,
              message_id: turn.messageId,
              occurred_at: turn.occurredAt,
              input_tokens: turn.inputTokens,
              output_tokens: turn.outputTokens,
              cache_read_input_tokens: turn.cacheReadInputTokens,
              cache_creation_input_tokens: turn.cacheCreationInputTokens,
              cache_creation_5m_input_tokens: turn.cacheCreationInputTokens,
              thinking_tokens: turn.thinkingTokens,
              web_search_requests: turn.webSearchRequests,
              model: turn.model,
              service_tier: 'standard',
              client_version: '2.1.280',
              spawn_depth: turn.spawnDepth,
            })
          }
          events.push({
            ...shared,
            kind: 'session_start',
            occurred_at: session.startedAt,
            detail: null,
          })
          if (session.endedAt) {
            events.push({
              ...shared,
              kind: 'session_end',
              occurred_at: session.endedAt,
              detail: null,
            })
          }
          if (session.failure) {
            events.push({
              ...shared,
              kind: 'stop_failure',
              occurred_at: session.failure.at,
              detail: tx.json({
                error_type: session.failure.errorType,
                message: session.failure.message,
              }),
            })
          }
          if (store && session.transcript) {
            const body = demoTranscript(session)
            const key = artifactKey({
              orgId: org.id,
              memberId: session.memberId,
              projectKey: session.projectKey,
              sessionId: session.sessionId,
              agentId: null,
              kind: 'transcript',
            })
            const at = session.turns.at(-1)!.occurredAt
            artifacts.push({
              org_id: org.id,
              member_id: session.memberId,
              project_id: session.projectId,
              session_id: session.sessionId,
              storage_key: key,
              sha256: createHash('sha256').update(body).digest('hex'),
              size_bytes: Buffer.byteLength(body),
              uploaded_at: at,
              created_at: at,
              kind: 'transcript',
            })
            objects.push({ key, body })
          }
        }
      }
    }

    await inBatches(
      turns,
      (batch) => tx`insert into turns ${tx(batch)} on conflict do nothing`,
    )
    await inBatches(
      events,
      (batch) =>
        tx`insert into session_events ${tx(batch)} on conflict do nothing`,
    )
    await inBatches(
      artifacts,
      (batch) =>
        tx`insert into log_artifacts ${tx(batch)} on conflict do nothing`,
    )

    if (seeded > 0) {
      // What the Devices page and the Project list show as last seen.
      await tx`
        update devices device set last_seen_at = latest.at
          from (select device_id, max(occurred_at) as at from turns
                 where org_id = any(${ids}::uuid[]) group by device_id) latest
         where device.id = latest.device_id
      `
      await tx`
        update projects project set last_seen_at = latest.at
          from (select project_id, max(occurred_at) as at from turns
                 where org_id = any(${ids}::uuid[]) group by project_id) latest
         where project.id = latest.project_id
      `
    }

    // A backfill is tens of thousands of Turns for Orgs the planner has no
    // statistics on, and until autovacuum catches up the Costs page's plan
    // was measured at 99s instead of about 1s. Only the owner may analyze,
    // and it counts this transaction's own rows. A daily top-up skips it.
    if (turns.length > ANALYZE_AFTER) await tx`analyze turns, session_events`

    // Storage last, inside the transaction: a failure rolls the rows back.
    // Keys are deterministic, so a retry overwrites what a failed call wrote.
    if (store) {
      for (const object of objects) {
        // oxlint-disable-next-line no-await-in-loop -- a few small objects.
        await store.put(object.key, object.body)
      }
      if (doomed.length > 0) {
        await store.remove(doomed.map((row) => row.storage_key))
      }
    }

    return {
      seeded,
      pruned: pruned.count,
      transcripts: objects.length,
    }
  })
