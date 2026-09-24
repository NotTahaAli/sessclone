import Link from 'next/link'

import { renameProjectAction } from './actions'
import { ColumnHead } from '../../../finder'
import { InlineName } from '../../../inline-name'
import { PageHeader } from '../../../page-header'
import { RangeControl } from '../../range-control'
import { SessionRows } from '../../session-rows'
import { sessionCount, TokenTable } from '../../token-table'
import { hrefWith, type Query } from '../../../query'
import { asViewer } from '../../../../../lib/db'
import { breakdown, type Dimension } from '../../../../../lib/breakdown'
import { compact, usd } from '../../../../../lib/money'
import { projectNickname } from '../../../../../lib/names'
import type { ResolvedRange } from '../../../../../lib/range'
import {
  sessionCursorOf,
  sessionList,
  type SessionFilter,
} from '../../../../../lib/sessions'
import { tokenBreakdown, type TokenCut } from '../../../../../lib/tokens'
import { reachesOrgSettings, type Viewer } from '../../../../../lib/viewer'

// Ticket 88's first level — a ranked row and what is under it — drawn two
// ways since ticket 112: as its own page (a phone, a sent link) and as the
// Finder column beside the Costs list on desktop. One component, so the two
// cannot disagree about what a group spent.
//
// The Role scoping is the policies' (ADR 0001) and nothing here. A Member
// opening a link to another Member's cut sees their own Turns in it, because
// `turns_read` hands them their own and no others.
//
// Since 2026-09-23 (Taha) the column opens with the cut's tokens by class and
// by model, one aggregate, and lists its Sessions rather than its Turns: the
// Sessions page's statement narrowed to the group, paged by its cursor.

/** What the cut is called, when the group has no name of its own. */
const UNNAMED: Record<Dimension, string> = {
  members: 'Outside your view',
  projects: 'No project reported',
  devices: 'No device reported',
}

const NOTHING: Record<Dimension, string> = {
  members: 'No Sessions from this person in this period.',
  projects: 'No Sessions in this Project in this period.',
  devices: 'No Sessions on this Device in this period.',
}

export async function Cut({
  viewer,
  dimension,
  id,
  resolved,
  query,
  closeHref,
}: {
  viewer: Viewer
  dimension: Dimension
  /** The group's id, or `none` for the group with no id. */
  id: string
  resolved: ResolvedRange
  query: Query
  /** Set when this is the Finder column: where its ✕ and ‹ go. */
  closeHref?: string
}) {
  const groupId = id === 'none' ? null : id

  // `id` rather than `groupId` for a Member: the caller has refused `none`
  // for one, and the cut type says the absent group is not expressible.
  const cut: TokenCut =
    dimension === 'members'
      ? { kind: 'members', id }
      : { kind: dimension, id: groupId }
  const filter: SessionFilter =
    dimension === 'members'
      ? { memberId: id }
      : dimension === 'projects'
        ? { projectId: groupId }
        : { deviceId: groupId }

  // Ticket 90: only a Project can be named, and only an Owner or Admin may —
  // so nobody else pays for the statement.
  const naming = dimension === 'projects' && groupId !== null
  const [ranked, tokens, page, nickname] = await asViewer(viewer.userId, (tx) =>
    Promise.all([
      // The group's name and totals, read by name rather than summed from
      // the page below: the page is capped, and a total summed from a capped
      // list drops the tail without saying so.
      breakdown(
        tx,
        viewer.orgId,
        viewer.orgTimezone,
        resolved.range,
        dimension,
        { id: groupId },
      ),
      tokenBreakdown(tx, viewer.orgId, viewer.orgTimezone, resolved.range, cut),
      sessionList(
        tx,
        viewer.orgId,
        viewer.orgTimezone,
        resolved.range,
        filter,
        { before: sessionCursorOf(query.before) },
      ),
      naming ? projectNickname(tx, groupId) : Promise.resolve(null),
    ]),
  )

  const [row] = ranked.rows
  const label = row?.label ?? UNNAMED[dimension]
  const path = `/costs/${dimension}/${id}`

  const title =
    naming && reachesOrgSettings(viewer.role) ? (
      <InlineName
        action={renameProjectAction}
        hidden={`projectId=${encodeURIComponent(id)}`}
        current={nickname}
        fallback={label}
        label="Name for this Project"
        placeholder="The dashboard"
        mono
      />
    ) : (
      label
    )

  const figures = row ? (
    <>
      <span className="font-mono">{usd(row.costUsd)}</span> ·{' '}
      {compact.format(row.tokens)} tokens · {sessionCount(row.sessions)} in this
      period
    </>
  ) : (
    'Nothing in this period.'
  )

  return (
    <div className="flex flex-col">
      {closeHref ? (
        <ColumnHead closeHref={closeHref} sub={figures}>
          {title}
        </ColumnHead>
      ) : (
        <>
          <PageHeader
            actions={
              // oxlint-disable-next-line react-perf/jsx-no-jsx-as-prop -- the header's actions slot takes its pill by design, and nothing here is memoised.
              <RangeControl path={path} resolved={resolved} query={query} />
            }
          >
            {title}
          </PageHeader>
          <p className="text-text-muted mt-2 text-caption">
            <Link
              href={hrefWith('/costs', query, { view: dimension })}
              className="hover:text-text"
            >
              ‹ {dimension === 'members' ? 'People' : `All ${dimension}`}
            </Link>
            {' · '}
            {figures}
          </p>
        </>
      )}

      {row ? <TokenTable totals={tokens} models={tokens.models} /> : null}
      {/* The next page opens the cut's own page, which is where a long list
          belongs. */}
      <SessionRows
        page={page}
        timezone={viewer.orgTimezone}
        empty={NOTHING[dimension]}
        path={path}
        query={query}
        standalone
      />
    </div>
  )
}
