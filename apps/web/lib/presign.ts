import type { ArtifactKind, PresignRefusal } from '@sessclone/shared'
import type postgres from 'postgres'

import { artifactKey, type ArtifactPath } from './storage'

// Ticket 58: what the presign route is allowed to say yes to.
//
// The five refusals of ADR 0003 in one read, decided from rows rather than
// from anything the caller sent. The Collector runs on the Member's machine,
// so every fact it offers about itself is a claim — which is why the Session's
// Project is resolved here from the Turns already ingested and the request
// carries no Project at all.
//
// This runs on the ingest connection, not `asViewer`: the caller is a
// Collector holding an API key, not a browser session, and the route has
// already resolved that key to a live Member (ticket 34). So there is no
// policy to satisfy and every statement below filters on that Member's own id
// explicitly — the identity came from the key, and it is the only thing that
// decides which rows this can see.

export type PresignDecision =
  | {
      allowed: true
      storageKey: string
      /**
       * The Project the Session resolved to, or null for a Session outside any
       * repository. Ticket 59's confirm route files the artifact row under it,
       * which is what ticket 61's retention and ticket 73's per-Project sweep
       * both find their rows by — so it is returned here rather than resolved
       * a second time from a second query that could disagree.
       */
      projectId: string | null
      /** What the key is built from, for the chunk and tail keys (ADR 0008). */
      path: ArtifactPath
      /**
       * What the row holds sealed (ADR 0008), or all zero when there is no
       * row, no chunks, or the chunks sit under a Project the Session has
       * since left — sealing then starts again from zero under the new one.
       */
      sealed: Sealed
    }
  | { allowed: false; refusal: PresignRefusal; detail: string }
  /** No live membership for that key. The route answers 401, as it does for
   * every other way a key fails to identify somebody. */
  | null

export type Sealed = { bytes: number; sha256: string | null; chunks: number }

type Facts = {
  archival_enabled: boolean
  tier_archival: boolean | null
  project_id: string | null
  project_key: string | null
  project_excluded: boolean
  stored_sha256: string | null
  stored_key: string | null
  sealed_bytes: string | null
  sealed_sha256: string | null
  chunks: number | null
}

/**
 * Whether this Member may upload this Session's transcript, and where it goes.
 *
 * One statement, not five. Each refusal is a different fact about the same
 * membership, and asking for them one at a time would be five round trips on
 * the path a Collector takes for every session it watches.
 *
 * The order the refusals are checked in is the order a person would fix them:
 * the Tier first, because no switch on the Member's machine changes it, then
 * the master switch, then the transient "not ingested yet", then the Project
 * exception, then the hash — which is not a refusal anybody acts on, just a
 * job already done.
 */
export const presignDecision = async (
  tx: postgres.Sql | postgres.TransactionSql,
  request: {
    orgId: string
    memberId: string
    sessionId: string
    agentId: string | null
    /** Ticket 104: a sidecar passes the same gates as its transcript. */
    kind: ArtifactKind
    sha256: string
  },
): Promise<PresignDecision> => {
  // Which Turns place this object in a Project. A transcript and an Agent
  // Run's `.meta.json` are placed by that run's own Turns; a workflow's
  // journal is keyed by a run id no Turn carries, so it is placed by the
  // Session's — any of them, which `turns_identity_key`'s leading
  // `(member_id, session_id)` still answers from the index.
  const sameRun =
    request.kind === 'workflow_journal'
      ? tx``
      : tx`and turn.agent_id is not distinct from ${request.agentId}`

  const [facts] = await tx<Facts[]>`
    select member.archival_enabled,
           tier.archival_available as tier_archival,
           session.project_id,
           project.key as project_key,
           coalesce(exception.archival_enabled = false, false) as project_excluded,
           artifact.sha256 as stored_sha256,
           artifact.storage_key as stored_key,
           artifact.sealed_bytes,
           artifact.sealed_sha256,
           -- ADR 0008. The chunks' primary key, (artifact_id, seq), answers this.
           (select count(*)::int from log_artifact_chunks chunk
             where chunk.artifact_id = artifact.id) as chunks
      from members member
      -- Only an active subscription entitles anything (lib/tier.ts): an Org
      -- on the Team Tier with a cancelled or never-activated subscription is
      -- on the Team Tier and entitled to nothing. Still a left join, so that
      -- case answers tier_excludes_archival rather than no row at all.
      left join subscriptions subscription
             on subscription.org_id = member.org_id
            and subscription.status = 'active'
      left join tiers tier on tier.id = subscription.tier_id
      -- The Session's Project, from the Turns already ingested. Latest wins:
      -- a Session that moved between repositories (ticket 09) is archived
      -- under where it is now, and the Turns are what say where that is.
      left join lateral (
        select turn.project_id
          from turns turn
         where turn.member_id = member.id
           and turn.session_id = ${request.sessionId}
           ${sameRun}
         -- Turns of one Session often share a timestamp, and on a tie the
         -- Project decides both the exclusion check and the storage key, so
         -- the order cannot be the planner's to choose.
         order by turn.occurred_at desc, turn.id desc
         limit 1
      ) session on true
      left join projects project on project.id = session.project_id
      left join member_project_archival exception
             on exception.member_id = member.id
            and exception.project_id = session.project_id
      left join log_artifacts artifact
             on artifact.member_id = member.id
            and artifact.session_id = ${request.sessionId}
            and artifact.agent_id is not distinct from ${request.agentId}
            and artifact.kind = ${request.kind}
     where member.id = ${request.memberId}
       and member.org_id = ${request.orgId}
       and member.removed_at is null
  `

  // No row at all means the key resolved to a Member who is no longer live.
  // The route answers 401 for that before reaching here; this is the belt, and
  // it is the same 401 rather than a refusal code a Collector would show
  // somebody as though a switch were off.
  if (!facts) return null

  // Null is an Org with no subscription, which is not an entitlement anybody
  // granted (ADR 0004): archival is a Tier capability, so no Tier is no
  // archival rather than all of it.
  if (facts.tier_archival !== true) {
    return {
      allowed: false,
      refusal: 'tier_excludes_archival',
      detail: 'this Org’s Tier does not include transcript archival',
    }
  }

  if (!facts.archival_enabled) {
    return {
      allowed: false,
      refusal: 'archival_off',
      detail: 'archival is off for this membership',
    }
  }

  // Transient, and the only refusal the Member cannot act on: the Collector
  // reports Turns and transcripts on different schedules, so a brand-new
  // Session is simply not ingested yet.
  if (!facts.project_id) {
    const [seen] = await tx<{ any: boolean }[]>`
      select true as any from turns turn
       where turn.member_id = ${request.memberId}
         and turn.session_id = ${request.sessionId}
         ${sameRun}
       limit 1
    `
    if (!seen) {
      return {
        allowed: false,
        refusal: 'no_turns',
        detail: 'this Session has not been ingested yet',
      }
    }
  }

  if (facts.project_excluded) {
    return {
      allowed: false,
      refusal: 'project_excluded',
      detail: 'this Session’s Project is excluded from archival',
    }
  }

  // The hash guard sits here rather than after the bytes have moved (ADR
  // 0003): refusing an unchanged transcript costs one small request instead
  // of a re-upload of the whole thing.
  if (facts.stored_sha256 === request.sha256) {
    return {
      allowed: false,
      refusal: 'unchanged',
      detail: 'this transcript is already stored',
    }
  }

  const path: ArtifactPath = {
    orgId: request.orgId,
    memberId: request.memberId,
    projectKey: facts.project_key,
    sessionId: request.sessionId,
    agentId: request.agentId,
    kind: request.kind,
  }

  // The row's chunks count only while its tail sits where this Session's
  // tail would be after them: a Session that moved Project has a different
  // prefix now, and its old chunks go with the replaced row (ADR 0008).
  const chunks = facts.chunks ?? 0
  const sealed: Sealed =
    chunks > 0 && facts.stored_key === artifactKey({ ...path, chunks })
      ? {
          bytes: Number(facts.sealed_bytes),
          sha256: facts.sealed_sha256,
          chunks,
        }
      : { bytes: 0, sha256: null, chunks: 0 }

  return {
    allowed: true,
    projectId: facts.project_id,
    storageKey: artifactKey(path),
    path,
    sealed,
  }
}
