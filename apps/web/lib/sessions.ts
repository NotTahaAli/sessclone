import type { TransactionSql } from 'postgres'

import type { LocalRange } from './series'

// Ticket 86: the Sessions themselves.
//
// Everything above this aggregates. Costs ranks models, projects, devices and
// people; a Session appears only when it failed (ticket 78). So a person who
// asks "what did that long session on Thursday cost, and what ran inside it?"
// has had nowhere to look. This is that.
//
// A Session is not a table. It is the `(member_id, session_id)` pair the
// Collector reports every Turn under, and its Agent Runs report under the same
// pair with an `agent_id` of their own (finding 74) — so they group rather
// than needing a record of their own, which is what the ticket asks for. The
// list therefore groups `turns`, and the only thing that is stored *about* a
// Session rather than derived from it is the `session_end` marker, which comes
// from `session_events`.
//
// Nothing here scopes by Role. `turns_read` and `session_events_read` do (ADR
// 0001), both through `sessclone_visible_member_ids()`: an Owner and an Admin
// see the Org, a Manager their Scope, a Member themselves. A page that
// filtered too would be a second answer to a question the database already
// answers, and the one that goes stale.

/** How many Sessions one page shows. A busy Org has thousands in a month. */
export const SESSION_PAGE = 25

export type SessionRow = {
  memberId: string
  sessionId: string
  /** The Member's address, or null when the row is not the viewer's to read —
   * the `left` join below says why that is not the same as absent. */
  memberEmail: string | null
  /** The name that person has set for themselves (ticket 91), or null. Shown
   * ahead of the address, never instead of it. */
  memberName: string | null
  projectKey: string | null
  /** The name the Org has given this Project (ticket 90), or null. The key is
   * still the identity and still what the breakdowns group on. */
  projectName: string | null
  /** The name somebody has given this Session (ticket 90), or null. */
  label: string | null
  deviceLabel: string | null
  /** The first Turn of the Session inside the period, ISO 8601 in UTC. */
  startedAt: string
  /** The last Turn's time. Not the end of the Session: see `endedAt`. */
  lastTurnAt: string
  /**
   * When Claude Code said the Session ended, or null when it never said.
   *
   * Null is a fact worth showing rather than hiding: `SessionEnd` fires about
   * 180ms after SIGTERM and not at all under SIGKILL (ticket 05), so a Session
   * with no end marker is one that was killed, is still running, or whose
   * final report never landed. A surface that filled the gap with the last
   * Turn's time would be inventing an ending.
   */
  endedAt: string | null
  turns: number
  /** Distinct `agent_id`s under this Session: its subagent runs. */
  agentRuns: number
  tokens: number
  /** Null, never zero, when nothing in the Session is priced (ADR 0002). */
  costUsd: number | null
  unpricedTurns: number
}

type RawSession = {
  member_id: string
  session_id: string
  member_email: string | null
  member_name: string | null
  project_key: string | null
  project_name: string | null
  label: string | null
  device_label: string | null
  started_at: Date
  last_turn_at: Date
  turns: string
  agent_runs: string
  tokens: string
  cost_usd: string | null
  unpriced_turns: string
}

/**
 * What every Session row is made of.
 *
 * The token sum is the four reported classes, as in `dailySpend` and
 * `breakdown`: the 5m and 1h splits are subsets of the reported cache-creation
 * total and thinking is a subset of output, so adding either counts a token
 * twice.
 *
 * The three labels are `max()` over the group rather than a grouping column.
 * A Session is one machine on one repository in practice, and grouping by the
 * labels as well would split a Session in two the moment a Turn arrived with a
 * Project not yet resolved — which is a real state, since `project_id` is
 * nullable. One row per Session, and the label is whichever the group has.
 */
const AGGREGATES = (tx: TransactionSql) => tx`
  max(account.email) as member_email,
  max(account.display_name) as member_name,
  max(project.key) as project_key,
  max(project.nickname) as project_name,
  max(naming.label) as label,
  max(coalesce(device.nickname, device.key)) as device_label,
  min(turn.occurred_at) as started_at,
  max(turn.occurred_at) as last_turn_at,
  count(*) as turns,
  count(distinct turn.agent_id) as agent_runs,
  sum(
    turn.input_tokens + turn.output_tokens + turn.cache_read_input_tokens
      + turn.cache_creation_input_tokens
  ) as tokens,
  sum(cost.cost_usd) as cost_usd,
  count(*) filter (where cost.unpriced) as unpriced_turns
`

/**
 * Every name join is `left`, which is the rule `breakdown` states and the
 * reason it gives: `turns_read` is not `members_read`, `projects_read` or
 * `devices_read`, so a Turn the viewer may read whose label row they may not
 * would vanish from an inner join — turning a leak-proof policy into a silent
 * undercount. An unreadable label comes back null and is named rather than
 * dropped.
 */
const SOURCE = (tx: TransactionSql) => tx`
  from turn_costs cost
  join turns turn on turn.id = cost.turn_id
  left join projects project on project.id = turn.project_id
  left join devices device on device.id = turn.device_id
  left join members member on member.id = turn.member_id
  left join users account on account.id = member.user_id
  -- Ticket 90. A left join, and read here rather than in a second statement:
  -- the pair it is keyed on is the pair the query already groups by, so it
  -- costs one join and cannot disagree with the row it names.
  left join session_labels naming
    on naming.member_id = turn.member_id
   and naming.session_id = turn.session_id
`

export type SessionFilter = {
  /** A Project id, or `null` for the Sessions that ran outside a repository. */
  projectId?: string | null
  memberId?: string
}

/** `(last turn, session id)`: the ordering key, so a page cannot repeat a row. */
export type SessionCursor = { lastTurnAt: string; sessionId: string }

/**
 * The Sessions of a period, newest first.
 *
 * Grouped over the period's Turns, which is the same pass `breakdown` makes
 * over the same rows: both quals land on `turns_org_occurred_at_idx`, so the
 * scan is the period and not the deployment (ticket 81).
 *
 * The cursor is a `having` rather than a `where`, because the key is an
 * aggregate — `max(occurred_at)` — and a `where` would drop the Turns that
 * produce it rather than the groups they belong to. The pair is compared as a
 * tuple: `max(occurred_at)` alone is not unique across Sessions, and a page
 * boundary that repeats or skips a row is worse than no paging at all.
 */
export const sessionList = async (
  tx: TransactionSql,
  orgId: string,
  timezone: string,
  range: LocalRange,
  { projectId, memberId }: SessionFilter = {},
  {
    limit = SESSION_PAGE,
    before,
  }: { limit?: number; before?: SessionCursor } = {},
): Promise<{ sessions: SessionRow[]; more: boolean }> => {
  const from = tx`(${range.from}::date)::timestamp at time zone ${timezone}`
  const to = tx`(${range.to}::date)::timestamp at time zone ${timezone}`

  const rows = await tx<RawSession[]>`
    select turn.member_id::text as member_id,
           turn.session_id,
           ${AGGREGATES(tx)}
      ${SOURCE(tx)}
     where cost.org_id = ${orgId}
       and turn.org_id = ${orgId}
       and cost.occurred_at >= ${from} and cost.occurred_at < ${to}
       and turn.occurred_at >= ${from} and turn.occurred_at < ${to}
       ${
         projectId === undefined
           ? tx``
           : projectId === null
             ? tx`and turn.project_id is null`
             : tx`and turn.project_id = ${projectId}`
       }
       ${memberId ? tx`and turn.member_id = ${memberId}` : tx``}
     group by turn.member_id, turn.session_id
     ${
       before
         ? tx`having (max(turn.occurred_at), turn.session_id)
                    < (${before.lastTurnAt}::timestamptz, ${before.sessionId})`
         : tx``
     }
     order by max(turn.occurred_at) desc, turn.session_id desc
     limit ${limit + 1}
  `

  const sessions = rows.slice(0, limit).map(asSession)

  // The end markers for this page, in one statement rather than one per row —
  // a query in a loop is a query in a loop whether the loop is over Orgs or
  // over Sessions. Two arrays rather than a tuple list, which over-matches
  // only when two Members share a session id (they are uuids, so never) and
  // keeps `session_events_session_idx` reachable on its leading column.
  const ends = await sessionEnds(tx, sessions)

  return {
    sessions: sessions.map((session) => ({
      ...session,
      endedAt: ends.get(key(session.memberId, session.sessionId)) ?? null,
    })),
    more: rows.length > limit,
  }
}

const key = (memberId: string, sessionId: string) => `${memberId}:${sessionId}`

const asSession = (row: RawSession): SessionRow => ({
  memberId: row.member_id,
  sessionId: row.session_id,
  memberEmail: row.member_email,
  memberName: row.member_name,
  projectKey: row.project_key,
  projectName: row.project_name,
  label: row.label,
  deviceLabel: row.device_label,
  startedAt: row.started_at.toISOString(),
  lastTurnAt: row.last_turn_at.toISOString(),
  endedAt: null,
  turns: Number(row.turns),
  agentRuns: Number(row.agent_runs),
  tokens: Number(row.tokens),
  costUsd: row.cost_usd === null ? null : Number(row.cost_usd),
  unpricedTurns: Number(row.unpriced_turns),
})

/**
 * When each of these Sessions ended, for the ones that said so.
 *
 * `agent_id is null` on purpose: an Agent Run reports its own `session_end`
 * under the parent's session id, and the Session ends when the Session ends
 * rather than when the last subagent stopped.
 *
 * `max` because `SessionStart` fires twice around a compaction and a requeued
 * report may arrive twice — the identity index dedups an identical
 * observation, not two with different timestamps.
 */
const sessionEnds = async (
  tx: TransactionSql,
  sessions: { memberId: string; sessionId: string }[],
): Promise<Map<string, string>> => {
  if (sessions.length === 0) return new Map()

  const rows = await tx<
    { member_id: string; session_id: string; ended_at: Date }[]
  >`
    select member_id::text as member_id, session_id,
           max(occurred_at) as ended_at
      from session_events
     where kind = 'session_end'
       and agent_id is null
       and member_id = any(${sessions.map((s) => s.memberId)}::uuid[])
       and session_id = any(${sessions.map((s) => s.sessionId)}::text[])
     group by member_id, session_id
  `

  return new Map(
    rows.map((row) => [
      key(row.member_id, row.session_id),
      row.ended_at.toISOString(),
    ]),
  )
}

/** One Agent Run under a Session: a subagent, summarised. */
export type AgentRun = {
  agentId: string
  turns: number
  tokens: number
  costUsd: number | null
  unpricedTurns: number
  startedAt: string
  lastTurnAt: string
  /** Deepest `spawn_depth` its Turns reported, or null when none did. */
  spawnDepth: number | null
}

/**
 * One Session, whatever period the reader came from.
 *
 * Deliberately unbounded by the range: a Session that straddles midnight on
 * the last day of the month is one Session and not two halves, and a detail
 * page that silently cut it at the period boundary would show a total that
 * disagrees with itself.
 *
 * Both columns of the filter, because `turns_identity_key` leads on
 * `member_id`: a session id on its own has no index behind it, and this read
 * would be a scan of every Turn on the deployment.
 */
export const sessionDetail = async (
  tx: TransactionSql,
  orgId: string,
  memberId: string,
  sessionId: string,
): Promise<{ session: SessionRow; agentRuns: AgentRun[] } | null> => {
  const [summary] = await tx<RawSession[]>`
    select turn.member_id::text as member_id,
           turn.session_id,
           ${AGGREGATES(tx)}
      ${SOURCE(tx)}
     where turn.org_id = ${orgId}
       and turn.member_id = ${memberId}
       and turn.session_id = ${sessionId}
     group by turn.member_id, turn.session_id
  `

  if (!summary) return null

  const [ends, runs] = await Promise.all([
    sessionEnds(tx, [{ memberId, sessionId }]),
    tx<
      {
        agent_id: string
        turns: string
        tokens: string
        cost_usd: string | null
        unpriced_turns: string
        started_at: Date
        last_turn_at: Date
        spawn_depth: number | null
      }[]
    >`
      select turn.agent_id,
             count(*) as turns,
             sum(
               turn.input_tokens + turn.output_tokens
                 + turn.cache_read_input_tokens
                 + turn.cache_creation_input_tokens
             ) as tokens,
             sum(cost.cost_usd) as cost_usd,
             count(*) filter (where cost.unpriced) as unpriced_turns,
             min(turn.occurred_at) as started_at,
             max(turn.occurred_at) as last_turn_at,
             max(turn.spawn_depth) as spawn_depth
        from turn_costs cost
        join turns turn on turn.id = cost.turn_id
       where turn.org_id = ${orgId}
         and turn.member_id = ${memberId}
         and turn.session_id = ${sessionId}
         and turn.agent_id is not null
       group by turn.agent_id
       order by min(turn.occurred_at)
    `,
  ])

  return {
    session: {
      ...asSession(summary),
      endedAt: ends.get(key(memberId, sessionId)) ?? null,
    },
    agentRuns: runs.map((run) => ({
      agentId: run.agent_id,
      turns: Number(run.turns),
      tokens: Number(run.tokens),
      costUsd: run.cost_usd === null ? null : Number(run.cost_usd),
      unpricedTurns: Number(run.unpriced_turns),
      startedAt: run.started_at.toISOString(),
      lastTurnAt: run.last_turn_at.toISOString(),
      spawnDepth: run.spawn_depth,
    })),
  }
}

/** One model's share of a Session (ticket 89). */
export type SessionModel = {
  /** Null when the Turn reported no model. Its own row, never dropped. */
  model: string | null
  turns: number
  tokens: number
  /** Null, never zero, when nothing in this model's Turns is priced. */
  costUsd: number | null
  unpricedTurns: number
}

/**
 * What one Session spent, per model (ticket 89).
 *
 * The Session summary is one figure and the Turn list is four hundred rows;
 * between them there was nothing, so "what did the Opus part cost" was
 * answered by reading four hundred rows. This is the same aggregate the
 * summary is, grouped by one more column — which is why the rows cannot sum
 * to something other than the tiles above them, and why `sessions.test.ts`
 * pins exactly that.
 *
 * Both columns of the filter, as everywhere in this file: `turns_identity_key`
 * leads on `member_id`, so a session id alone has no index behind it.
 *
 * A Turn with no model is a row of its own rather than a drop. `turns.model`
 * is nullable and `<synthetic>` is a real value no Rate will ever match, so
 * those Turns are in the Session's total and this says where they went.
 */
export const sessionModels = async (
  tx: TransactionSql,
  orgId: string,
  memberId: string,
  sessionId: string,
): Promise<SessionModel[]> => {
  const rows = await tx<
    {
      model: string | null
      turns: string
      tokens: string
      cost_usd: string | null
      unpriced_turns: string
    }[]
  >`
    select turn.model,
           count(*) as turns,
           sum(
             turn.input_tokens + turn.output_tokens
               + turn.cache_read_input_tokens
               + turn.cache_creation_input_tokens
           ) as tokens,
           sum(cost.cost_usd) as cost_usd,
           count(*) filter (where cost.unpriced) as unpriced_turns
      from turn_costs cost
      join turns turn on turn.id = cost.turn_id
     where turn.org_id = ${orgId}
       and turn.member_id = ${memberId}
       and turn.session_id = ${sessionId}
     group by turn.model
     -- Biggest spend first, and a model with nothing priced last rather than
     -- first: nulls last on a descending sort, as the ranked lists order.
     order by sum(cost.cost_usd) desc nulls last, count(*) desc
  `

  return rows.map((row) => ({
    model: row.model,
    turns: Number(row.turns),
    tokens: Number(row.tokens),
    costUsd: row.cost_usd === null ? null : Number(row.cost_usd),
    unpricedTurns: Number(row.unpriced_turns),
  }))
}

/**
 * The transcripts stored for one Session — the main one, and one per Agent Run
 * (finding 74).
 *
 * `log_artifacts_read` decides which of them the viewer may have, so this
 * names no Member beyond the one it is asked for. An absent row is not hidden
 * by the surface: archival is opt-in per Member and off by default, so "there
 * is no transcript" is the common case and the page says which reason applies
 * rather than rendering nothing, which reads as a bug.
 */
export type StoredTranscript = {
  id: string
  agentId: string | null
  bytes: number
  uploadedAt: string
}

export const sessionTranscripts = async (
  tx: TransactionSql,
  memberId: string,
  sessionId: string,
): Promise<StoredTranscript[]> => {
  const rows = await tx<
    {
      id: string
      agent_id: string | null
      size_bytes: string
      uploaded_at: Date
    }[]
  >`
    select id, agent_id, size_bytes, uploaded_at
      from log_artifacts
     where member_id = ${memberId}
       and session_id = ${sessionId}
     order by agent_id nulls first
  `

  return rows.map((row) => ({
    id: row.id,
    agentId: row.agent_id,
    bytes: Number(row.size_bytes),
    uploadedAt: row.uploaded_at.toISOString(),
  }))
}

/**
 * Why a Session has no stored transcript, when it has none.
 *
 * Read from the Member's switch on `members` and the Project's exception row
 * (ADR 0005) — and the two are not equally readable, which shapes what this
 * can honestly say. `member_project_archival_own` is
 * `sessclone_own_member_ids()`: the exception list is the Member's own in both
 * directions, and an Admin "can neither read nor write another Member's
 * exclusions". So `excluded` comes back only for the Member themselves, and
 * for everybody else an excluded Project is indistinguishable from an
 * unexcluded one.
 *
 * That is why `on` is the weakest of the three answers, and why the surface
 * words it as a list of possibilities rather than as a diagnosis: claiming
 * "archival is on, so it should have uploaded" to an Admin who cannot see the
 * exclusion would be the page asserting something the policies deny it.
 *
 * Null when the `members` row itself is not readable, and the surface then
 * says so rather than guessing.
 */
export const archivalReason = async (
  tx: TransactionSql,
  memberId: string,
  projectId: string | null,
): Promise<'off' | 'excluded' | 'on' | null> => {
  const [row] = await tx<
    { archival_enabled: boolean; excluded: boolean | null }[]
  >`
    select member.archival_enabled,
           exception.archival_enabled as excluded
      from members member
      left join member_project_archival exception
        on exception.member_id = member.id
       and exception.project_id = ${projectId}
     where member.id = ${memberId}
  `

  if (!row) return null
  if (row.excluded === false) return 'excluded'
  return row.archival_enabled ? 'on' : 'off'
}

/**
 * The Projects and the people a Sessions list can be filtered by.
 *
 * Read from `projects` and `members` rather than from the period's Turns: both
 * are small, both are already policy-scoped, and deriving the lists from a
 * second aggregate over the range would double the page's cost to populate two
 * `select` elements. The consequence is that a filter may name a Project with
 * no Sessions in the chosen period, which reads as an empty list — honest, and
 * cheaper than the alternative.
 */
export const sessionFilters = async (
  tx: TransactionSql,
  orgId: string,
): Promise<{
  projects: { id: string; key: string }[]
  people: { id: string; email: string }[]
}> => {
  const [projects, people] = await Promise.all([
    tx<{ id: string; key: string }[]>`
      select id, coalesce(nickname, key) as key
        from projects where org_id = ${orgId} order by coalesce(nickname, key)
    `,
    tx<{ id: string; email: string }[]>`
      select member.id,
             coalesce(account.display_name, account.email) as email
        from members member
        join users account on account.id = member.user_id
       where member.org_id = ${orgId}
       order by coalesce(account.display_name, account.email)
    `,
  ])

  return { projects, people }
}
