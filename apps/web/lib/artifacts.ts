import type { TransactionSql } from 'postgres'

import { deleteObjects, keysUnder } from './storage'

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

export type StoredProject = {
  memberId: string
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
export const storedProjects = async (
  tx: TransactionSql,
): Promise<StoredProject[]> => {
  const rows = await tx<
    {
      member_id: string
      project_id: string | null
      project_key: string | null
      sessions: string
      bytes: string
      newest: Date
    }[]
  >`
    select artifact.member_id,
           artifact.project_id,
           project.key as project_key,
           count(*) as sessions,
           coalesce(sum(artifact.size_bytes), 0) as bytes,
           max(artifact.uploaded_at) as newest
      from log_artifacts artifact
      left join projects project on project.id = artifact.project_id
     where artifact.member_id in (select sessclone_own_member_ids())
     group by artifact.member_id, artifact.project_id, project.key
     order by max(artifact.uploaded_at) desc
  `

  return rows.map((row) => ({
    memberId: row.member_id,
    projectId: row.project_id,
    projectKey: row.project_key,
    sessions: Number(row.sessions),
    bytes: Number(row.bytes),
    newest: row.newest,
  }))
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
  limit = SESSION_PAGE,
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
     where member_id in (select sessclone_own_member_ids())
     order by uploaded_at desc, id desc
     limit ${limit + 1}
  `

  return {
    sessions: rows.slice(0, limit).map((row) => ({
      id: row.id,
      memberId: row.member_id,
      projectId: row.project_id,
      sessionId: row.session_id,
      agentId: row.agent_id,
      bytes: Number(row.size_bytes),
      uploadedAt: row.uploaded_at,
    })),
    more: rows.length > limit,
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
 * already gone — so the page reports what happened rather than claiming a
 * deletion the policy refused.
 */
export const deleteStoredSession = async (
  tx: TransactionSql,
  artifactId: string,
): Promise<boolean> => {
  const rows = await tx<{ storage_key: string }[]>`
    delete from log_artifacts
     where id = ${artifactId}
       and member_id in (select sessclone_own_member_ids())
    returning storage_key
  `
  if (rows.length === 0) return false

  await deleteObjects(rows.map((row) => row.storage_key))
  return true
}

/**
 * Destroys everything stored for one of the Member's Projects.
 *
 * The sweep is by prefix, as ADR 0005 says: the keys are listed from storage
 * under `orgs/…/members/…/projects/…/` and deleted in batches, rather than one
 * request per row. That also catches an object whose row was already gone —
 * the one direction the ordering above cannot rule out, if a commit fails
 * after the bytes went.
 *
 * Returns how many rows went, which is what the page reports. Safe to re-run:
 * a second sweep finds no rows and deletes the objects that are no longer
 * there, both of which succeed.
 */
export const deleteStoredProject = async (
  tx: TransactionSql,
  memberId: string,
  projectId: string | null,
): Promise<number> => {
  const rows = await tx<{ storage_key: string }[]>`
    delete from log_artifacts
     where member_id = ${memberId}
       and member_id in (select sessclone_own_member_ids())
       and project_id is not distinct from ${projectId}
    returning storage_key
  `
  if (rows.length === 0) return 0

  // The prefixes come from the rows this statement just deleted, and not from
  // the Org id and Project key read back separately. Storage has no policies,
  // so a prefix assembled from anything the policy did not already hand back
  // is a prefix nobody checked — and a Project the viewer cannot read would
  // assemble the *wrong* one, which sweeps somebody else's group rather than
  // this one. A row renamed since it was written keeps its own old prefix
  // here, which is the one its object actually sits under.
  const prefixes = new Set(rows.map((row) => row.storage_key).map(prefixOf))
  const listed = await Promise.all([...prefixes].map(keysUnder))

  // The listing as well as the rows' own keys: the listing catches an object
  // whose row was already gone, and the rows catch an object a listing has
  // not caught up with.
  await deleteObjects([
    ...new Set([...rows.map((row) => row.storage_key), ...listed.flat()]),
  ])

  return rows.length
}

/**
 * The Project prefix one artifact key sits under, cut from the key itself.
 *
 * `orgs/<org>/members/<member>/projects/<key>/<session>.jsonl` — the prefix is
 * everything up to and including the slash after the Project segment. A key
 * that is not that shape sweeps nothing rather than sweeping something wider:
 * the row's own key is deleted either way.
 */
const prefixOf = (key: string) => {
  const parts = key.split('/')
  return parts.length > 5 && parts[4] === 'projects'
    ? `${parts.slice(0, 6).join('/')}/`
    : key
}
