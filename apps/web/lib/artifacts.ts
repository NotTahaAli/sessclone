import type { TransactionSql } from 'postgres'

import { deleteObjects } from './storage'

// Ticket 73: destroying transcripts that are already stored.
//
// ADR 0005 keeps this apart from the archival switch on purpose — *stop
// collecting* and *destroy what you hold* are different intentions and must
// not share a click — and keeps it the Member's own: `log_artifacts_delete` is
// `sessclone_own_member_ids()`, which is narrower than the read policy beside
// it. An Admin may download a Member's transcript and may not destroy it.
//
// Two granularities, both from ADR 0005: one Session, or a whole Project. The
// Project one sweeps by the object key's prefix (ADR 0003 shaped the key for
// it), so a Project with a thousand Sessions is one list and one delete rather
// than a request per object.
//
// Deleting is not an opt-out. A later Session on a Project that is not
// excluded uploads again, because the presign route reads the switches and not
// this table — the only thing a deleted row changes there is that the
// unchanged-hash refusal no longer applies.

/**
 * Whose transcripts a listing is about (ticket 84).
 *
 * `own` is the signed-in person's, which is what `/settings/you` shows. `team`
 * is every Member the viewer may see, which is what an Owner, an Admin or a
 * Manager reaches — and it is a different set rather than a wider one only
 * because the policies say so: the statement asks for
 * `sessclone_visible_member_ids()` and the policy is still what decides which
 * ids that returns (ADR 0001). Nothing here names a Role.
 */
export type Audience = 'own' | 'team'

const memberIds = (tx: TransactionSql, audience: Audience) =>
  audience === 'own'
    ? tx`select sessclone_own_member_ids()`
    : tx`select sessclone_visible_member_ids()`

/**
 * What a listing is asking for.
 *
 * `group` narrows to one membership and one Project, which is how a team
 * listing stays both index-backed and complete: the page lists the groups,
 * and each group's Sessions are read by equality on `member_id`. `before` is
 * the cursor inside a group — `(uploaded_at, id)` because `uploaded_at` alone
 * is not unique and a page boundary that repeats or skips a row is worse than
 * no paging at all.
 */
export type Listing = {
  audience?: Audience
  limit?: number
  group?: { memberId: string; projectId: string | null }
  before?: { uploadedAt: Date; id: string }
}

export type StoredProject = {
  memberId: string
  /**
   * Who it belongs to, for a `team` listing.
   *
   * Left joined rather than inner so a listing can never silently drop a
   * transcript it is allowed to show — which is belt and braces rather than a
   * reachable state: `log_artifacts_read` and `users_read` resolve through the
   * same visible-member set, so a readable artifact implies a readable
   * address.
   */
  memberEmail: string | null
  /**
   * The Org the group belongs to, for a `team` listing.
   *
   * `sessclone_visible_member_ids()` unions every Org the caller owns or
   * administers *and* their own memberships elsewhere, so a team listing can
   * legitimately carry rows from a second Org — and a page that showed them
   * under one Org's name would be claiming something untrue about where a
   * transcript came from.
   */
  orgName: string | null
  projectId: string | null
  /** Null is the Sessions that ran outside any repository. */
  projectKey: string | null
  sessions: number
  bytes: number
  newest: Date
}

export type StoredSession = {
  id: string
  memberId: string
  projectId: string | null
  sessionId: string
  agentId: string | null
  bytes: number
  uploadedAt: Date
  /**
   * When the last message of this Session was reported, or null when no Turn
   * of it is readable.
   *
   * Taha asked for the last message rather than the upload (2026-09-22): a
   * transcript is uploaded when the Session ends, which is a fact about the
   * Collector and not about the work — and a machine that was asleep uploads
   * hours after the session everybody remembers. The upload time is still
   * what the list is ordered and paged by, because that is the column the
   * index covers; only what is shown changes.
   *
   * Null rather than a fallback, so a caller decides what to say. A Turn is
   * readable under the same visible-member set as the artifact, so null here
   * means a transcript whose Turns never arrived, not a permission edge.
   */
  lastTurnAt: Date | null
}

/** Bounded: a Member with a year of archived work has thousands of rows. */
export const SESSION_PAGE = 100

/**
 * What the viewer has stored, a line per Project of each of their
 * memberships.
 *
 * Every membership in one statement rather than one statement per membership:
 * the page renders all of them, and a query in a loop is a query in a loop
 * whether the loop is over Orgs or over rows.
 *
 * The summary rather than the rows, because the question the page answers
 * first is "what is being kept about me, and how much of it" — one aggregate
 * read instead of pulling every artifact to count them in JavaScript.
 */
/** Bounded like the Session list: an Org with 500 Members has 500+ groups. */
export const PROJECT_PAGE = 50

export const storedProjects = async (
  tx: TransactionSql,
  { audience = 'own', limit = PROJECT_PAGE, group }: Listing = {},
): Promise<{ projects: StoredProject[]; more: boolean }> => {
  const rows = await tx<
    {
      member_id: string
      member_email: string | null
      org_name: string | null
      project_id: string | null
      project_key: string | null
      sessions: string
      bytes: string
      newest: Date
    }[]
  >`
    select artifact.member_id,
           ${audience === 'team' ? tx`coalesce(person.display_name, person.email)` : tx`null::text`}
             as member_email,
           ${audience === 'team' ? tx`org.name` : tx`null::text`} as org_name,
           artifact.project_id,
           -- Ticket 90: the Org's name for the Project, or its key.
           coalesce(project.nickname, project.key) as project_key,
           -- Transcripts, not the sidecars beside them (ticket 104) — which
           -- do count towards the bytes stored.
           count(*) filter (where artifact.kind = 'transcript') as sessions,
           coalesce(sum(artifact.size_bytes), 0) as bytes,
           max(artifact.uploaded_at) as newest
      from log_artifacts artifact
      left join projects project on project.id = artifact.project_id
      ${
        // Only a team listing renders the address, and the own page would
        // otherwise pay for two joins per render to select a column nothing
        // reads.
        audience === 'team'
          ? tx`left join members member on member.id = artifact.member_id
      left join users person on person.id = member.user_id
      left join orgs org on org.id = artifact.org_id`
          : tx``
      }
     where artifact.member_id in (${memberIds(tx, audience)})
       and artifact.kind = 'transcript'
       ${
         // One group, for the page that opens it: the summary it shows is the
         // same aggregate, and asking for it by name is one row instead of
         // every group the viewer can see.
         group
           ? tx`and artifact.member_id = ${group.memberId}
         and artifact.project_id is not distinct from ${group.projectId}`
           : tx``
       }
     group by artifact.member_id, ${
       audience === 'team'
         ? tx`coalesce(person.display_name, person.email), org.name,`
         : tx``
     } artifact.project_id, coalesce(project.nickname, project.key)
     order by max(artifact.uploaded_at) desc
     limit ${limit + 1}
  `

  const projects = rows.slice(0, limit).map((row) => ({
    memberId: row.member_id,
    memberEmail: row.member_email,
    orgName: row.org_name,
    projectId: row.project_id,
    projectKey: row.project_key,
    sessions: Number(row.sessions),
    bytes: Number(row.bytes),
    newest: row.newest,
  }))

  return { projects, more: rows.length > limit }
}

/**
 * The viewer's stored Sessions, newest first, across every membership.
 *
 * All of them in one statement and grouped by the caller, rather than a query
 * per Project: the page shows every group, and a hundred Projects would
 * otherwise be a hundred round trips. `limit + 1` says whether the cap was
 * reached without a second count.
 */
export const storedSessions = async (
  tx: TransactionSql,
  { audience = 'own', limit = SESSION_PAGE, group, before }: Listing = {},
): Promise<{ sessions: StoredSession[]; more: boolean }> => {
  const rows = await tx<
    {
      id: string
      member_id: string
      project_id: string | null
      session_id: string
      agent_id: string | null
      size_bytes: string
      uploaded_at: Date
    }[]
  >`
    select id, member_id, project_id, session_id, agent_id, size_bytes,
           uploaded_at
      from log_artifacts
     -- One Member by equality when a group is named, which is what lets
     -- log_artifacts_member_uploaded_idx answer the order as well as the
     -- filter. Across a whole Org the ordering cannot come from that index
     -- (the id set has many Members in it), so a group is the unit a team
     -- listing pages by.
     where ${
       group
         ? tx`member_id = ${group.memberId}
           and member_id in (${memberIds(tx, audience)})
           and project_id is not distinct from ${group.projectId}`
         : tx`member_id in (${memberIds(tx, audience)})`
     }
       -- A sidecar is not a transcript to list (ticket 104).
       and kind = 'transcript'
       ${
         before
           ? tx`and (uploaded_at, id) < (${before.uploadedAt}, ${before.id})`
           : tx``
       }
     order by uploaded_at desc, id desc
     limit ${limit + 1}
  `

  const page = rows.slice(0, limit).map((row) => ({
    id: row.id,
    memberId: row.member_id,
    projectId: row.project_id,
    sessionId: row.session_id,
    agentId: row.agent_id,
    bytes: Number(row.size_bytes),
    uploadedAt: row.uploaded_at,
  }))

  const last = await lastTurns(tx, page)

  return {
    sessions: page.map((session) => ({
      ...session,
      lastTurnAt:
        last.get(
          turnKey(session.memberId, session.sessionId, session.agentId),
        ) ?? null,
    })),
    more: rows.length > limit,
  }
}

const turnKey = (memberId: string, sessionId: string, agentId: string | null) =>
  `${memberId}:${sessionId}:${agentId ?? ''}`

/**
 * The last Turn of each of these transcripts, in one statement.
 *
 * One statement for the whole page rather than one per row: a query in a loop
 * is a query in a loop (AGENTS.md), and this page lists up to a hundred.
 *
 * The two `any` quals are a superset of the pairs the page holds — Postgres
 * has no tuple-array qual that stays index-backed — so a Session id belonging
 * to another Member of the page can be read as well. That costs a few rows and
 * changes no answer: the grouping carries the Member, so a lookup never
 * crosses one. `turns_identity_key` leads on `(member_id, session_id)`, which
 * is exactly what both quals name.
 *
 * `agent_id` is grouped and matched too, because an Agent Run has its own
 * transcript under its parent's Session id — its row's last message is the
 * subagent's, not the parent's.
 */
const lastTurns = async (
  tx: TransactionSql,
  sessions: { memberId: string; sessionId: string; agentId: string | null }[],
): Promise<Map<string, Date>> => {
  if (sessions.length === 0) return new Map()

  const rows = await tx<
    {
      member_id: string
      session_id: string
      agent_id: string | null
      last_at: Date
    }[]
  >`
    select member_id::text as member_id, session_id, agent_id,
           max(occurred_at) as last_at
      from turns
     where member_id = any(${sessions.map((s) => s.memberId)}::uuid[])
       and session_id = any(${sessions.map((s) => s.sessionId)}::text[])
     group by member_id, session_id, agent_id
  `

  return new Map(
    rows.map((row) => [
      turnKey(row.member_id, row.session_id, row.agent_id),
      row.last_at,
    ]),
  )
}

/**
 * One artifact the viewer may download, or null (ticket 60).
 *
 * The policy is the whole authorisation: `log_artifacts_read` is
 * `sessclone_visible_member_ids()`, so this statement names no Member and
 * filters on nothing but the id — a Member gets their own, an Owner and an
 * Admin any Member's, and a Manager only their Scope. An artifact outside that
 * set is no row, which the route answers as a 404 rather than a 403: a
 * distinguishable refusal would confirm that a transcript somebody cannot see
 * exists.
 *
 * The filename is built here rather than in the route because it is built from
 * the same row: `<session>.jsonl`, or `<session>-agent-<id>.jsonl` for an
 * Agent Run, which is what a person wants when four of them land in one
 * downloads folder.
 */
export const downloadableArtifact = async (
  tx: TransactionSql,
  id: string,
): Promise<{
  memberId: string
  storageKey: string
  filename: string
  contentType: string
} | null> => {
  const [row] = await tx<
    { member_id: string; storage_key: string; name: string; kind: string }[]
  >`
    select member_id, storage_key, kind,
           case when agent_id is null then session_id
                when kind = 'workflow_journal'
                  then session_id || '-workflow-' || agent_id
                else session_id || '-agent-' || agent_id
           end as name
      from log_artifacts where id = ${id}
  `
  if (!row) return null
  // A sidecar (ticket 104) downloads as what it is.
  const [extension, contentType] =
    row.kind === 'agent_meta'
      ? ['.meta.json', 'application/json']
      : row.kind === 'workflow_journal'
        ? ['.journal.jsonl', 'application/x-ndjson']
        : ['.jsonl', 'application/x-ndjson']
  return {
    memberId: row.member_id,
    storageKey: row.storage_key,
    filename: `${row.name}${extension}`,
    contentType,
  }
}

/**
 * Destroys one Session's stored transcript.
 *
 * The row and the object go together, and the order is what makes that true
 * under failure: the row is deleted inside the caller's transaction, the
 * object is deleted next, and the transaction commits only if that succeeded.
 * A storage failure rolls the row back, so the pair is either both there or
 * both gone rather than a row pointing at nothing.
 *
 * Returns false when nothing was deleted — somebody else's artifact, or one
 * already gone. The page does not distinguish the two: it only renders the
 * viewer's own rows, so a refusal there means a post somebody assembled by
 * hand, and an answer that told them which it was would be an oracle. The
 * boolean is for a caller that has a reason to know.
 */
export const deleteStoredSession = async (
  tx: TransactionSql,
  artifactId: string,
): Promise<boolean> => {
  // The transcript and its sidecars in one statement (ticket 104): an Agent
  // Run's `.meta.json`, and for the Session's own transcript its workflows'
  // journals. A sidecar's id names no transcript and deletes nothing.
  const rows = await tx<{ storage_key: string }[]>`
    with transcript as (
      select member_id, session_id, agent_id from log_artifacts
       where id = ${artifactId}
         and kind = 'transcript'
         and member_id in (select sessclone_own_member_ids())
    )
    delete from log_artifacts artifact
     using transcript
     where artifact.member_id = transcript.member_id
       and artifact.session_id = transcript.session_id
       and (artifact.kind in ('transcript', 'agent_meta')
              and artifact.agent_id is not distinct from transcript.agent_id
            or artifact.kind = 'workflow_journal'
              and transcript.agent_id is null)
    returning artifact.storage_key
  `
  if (rows.length === 0) return false

  await deleteObjects(rows.map((row) => row.storage_key))
  return true
}

/**
 * Destroys everything stored for one of the Member's Projects.
 *
 * One delete for the whole Project rather than a request per object: the
 * statement returns every key it removed and they go in batches of a
 * thousand, which is what ADR 0005's prefix sweep is for.
 *
 * It deletes exactly the keys of the rows it deleted, and deliberately does
 * not also list the bucket under the Project's prefix. A listing would reach
 * an object whose row this transaction never saw — an upload that lands while
 * the sweep runs writes its row outside this transaction, so it survives
 * while its bytes would not, which is precisely the orphan the ordering below
 * exists to prevent. A Collector uploading during a sweep is the normal case,
 * not an exotic one: deleting is not an opt-out, so the next Session uploads.
 *
 * Returns how many rows went, which is what the page reports. Safe to re-run:
 * a second sweep finds no rows and does nothing.
 */
export const deleteStoredProject = async (
  tx: TransactionSql,
  memberId: string,
  projectId: string | null,
): Promise<number> => {
  const rows = await tx<{ storage_key: string; kind: string }[]>`
    delete from log_artifacts
     where member_id = ${memberId}
       and member_id in (select sessclone_own_member_ids())
       and project_id is not distinct from ${projectId}
    returning storage_key, kind
  `
  if (rows.length === 0) return 0

  // The keys come from the rows the policy just handed back, never from the
  // browser: storage has no policies, so a key assembled from anything else
  // is a key nobody checked.
  await deleteObjects(rows.map((row) => row.storage_key))

  // Transcripts, which is what the page counts; their sidecars went too.
  return rows.filter((row) => row.kind === 'transcript').length
}
