import type { TransactionSql } from 'postgres'

import type { SessionState } from './names'
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
  /** Archived, hidden, or null for an ordinary listed Session (ticket 92). */
  state: SessionState | null
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
  /**
   * Whether the Session ran on a cloud Device, whose key starts `cloud:`
   * (`deviceKey` in `packages/shared`). Claude Code never runs `SessionEnd`
   * in a cloud container, archived or reclaimed alike (Taha, 2026-09-22), so
   * a missing end there is the normal state rather than a warning. A cloud
   * environment that sets `SESSCLONE_DEVICE` loses the prefix and reads as a
   * machine: the key is all the server knows about where a Turn ran.
   */
  cloud: boolean
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
  state: SessionState | null
  device_label: string | null
  cloud: boolean
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
  max(naming.state) as state,
  max(coalesce(device.nickname, device.key)) as device_label,
  coalesce(bool_or(device.key like 'cloud:%'), false) as cloud,
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
  /**
   * Which shelf to read (ticket 92). `listed` is the default and the one a
   * reader arrives on; `archived` is the filter that brings them back.
   *
   * There is deliberately no value that returns the hidden ones. Hidden means
   * no list, and an option for it would make it a second archive with a
   * longer name — the detail page is how a hidden Session is reached.
   */
  state?: 'listed' | 'archived'
  /** Ticket 93: matched against the Session's name and its id. */
  search?: string
  /** Ticket 93: only the Sessions that ended a Turn on an API error. */
  failedOnly?: boolean
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
  {
    projectId,
    memberId,
    state = 'listed',
    search,
    failedOnly,
  }: SessionFilter = {},
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
       ${
         // Ticket 92. A `where` rather than a `having`, because the state is
         // one value per Session and the join already carries it onto every
         // Turn of the group — so the planner drops the Turns before it
         // aggregates them rather than after.
         //
         // `listed` tests `is null` on the joined column, which is both the
         // Session with no row at all and the one whose row holds only a
         // name. `distinct from` rather than `<>`, for the second of those:
         // `state <> 'hidden'` is null, and therefore not true, on a row that
         // has a label and no state.
         state === 'archived'
           ? tx`and naming.state = 'archived'`
           : tx`and naming.state is distinct from 'archived'
                and naming.state is distinct from 'hidden'`
       }
       ${
         // Ticket 93. The name or the id, which are the two things a reader
         // has in hand. `ilike` with both wildcards: a session id is a uuid
         // nobody types in full, so a prefix match would answer nothing.
         search
           ? tx`and (naming.label ilike ${'%' + search + '%'}
                     or turn.session_id ilike ${'%' + search + '%'})`
           : tx``
       }
       ${
         // Ticket 93. A `stop_failure`, which is what ticket 40 records and
         // ticket 78 reads. Not "no end marker": that Session was killed or
         // is still running (ticket 05), and calling it failed would be
         // inventing an ending.
         //
         // `exists` rather than a join, because a Session may have several
         // failures and a join would multiply every aggregate above by their
         // number.
         failedOnly
           ? tx`and exists (
                  select 1 from session_events failure
                   where failure.kind = 'stop_failure'
                     and failure.member_id = turn.member_id
                     and failure.session_id = turn.session_id
                )`
           : tx``
       }
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
  state: row.state,
  deviceLabel: row.device_label,
  cloud: row.cloud,
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
  /**
   * The four reported classes added up, and the figure ticket 89 showed.
   * Kept beside the four below so a caller that wants the one number does not
   * have to add them and risk adding a fifth.
   */
  tokens: number
  /** Ticket 94: the same total, split the way the reader reads a bill. */
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  /**
   * The reported cache-creation total. Deliberately not the 5m and 1h
   * columns: those are subsets of this one, and a column each beside it would
   * count a token twice on any reader's mental sum.
   */
  cacheWriteTokens: number
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
      input_tokens: string
      output_tokens: string
      cache_read_tokens: string
      cache_write_tokens: string
      cost_usd: string | null
      unpriced_turns: string
    }[]
  >`
    select turn.model,
           count(*) as turns,
           sum(turn.input_tokens) as input_tokens,
           sum(turn.output_tokens) as output_tokens,
           sum(turn.cache_read_input_tokens) as cache_read_tokens,
           sum(turn.cache_creation_input_tokens) as cache_write_tokens,
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

  return rows.map((row) => {
    const inputTokens = Number(row.input_tokens)
    const outputTokens = Number(row.output_tokens)
    const cacheReadTokens = Number(row.cache_read_tokens)
    const cacheWriteTokens = Number(row.cache_write_tokens)

    return {
      model: row.model,
      turns: Number(row.turns),
      // Added here rather than in the statement, so there is one place the
      // four classes are summed and no chance of the total disagreeing with
      // the columns printed beside it.
      tokens: inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      costUsd: row.cost_usd === null ? null : Number(row.cost_usd),
      unpricedTurns: Number(row.unpriced_turns),
    }
  })
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
       -- Not the sidecars beside them (ticket 104).
       and kind = 'transcript'
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
