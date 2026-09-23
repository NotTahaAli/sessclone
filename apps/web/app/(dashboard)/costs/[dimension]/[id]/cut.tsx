import Link from 'next/link'

import { renameProjectAction } from './actions'
import { ColumnHead } from '../../../finder'
import { InlineName } from '../../../inline-name'
import { PageHeader } from '../../../page-header'
import { RangeControl } from '../../range-control'
import { TurnRows } from '../../../turns/turn-row'
import { hrefWith, one, type Query } from '../../../query'
import { SectionBreak } from '../../../../_ui/primitives'
import { asViewer } from '../../../../../lib/db'
import { breakdown, type Dimension } from '../../../../../lib/breakdown'
import { compact, usd } from '../../../../../lib/money'
import { projectNickname } from '../../../../../lib/names'
import type { ResolvedRange } from '../../../../../lib/range'
import {
  turnList,
  type TurnCursor,
  type TurnFilter,
} from '../../../../../lib/turns'
import { reachesOrgSettings, type Viewer } from '../../../../../lib/viewer'

// Ticket 88's first level — a ranked row and the Turns under it — drawn two
// ways since ticket 112: as its own page (a phone, a sent link) and as the
// Finder column beside the Costs list on desktop. One component, so the two
// cannot disagree about what a group spent.
//
// The Role scoping is the policies' (ADR 0001) and nothing here. A Member
// opening a link to another Member's cut sees their own Turns in it, because
// `turns_read` hands them their own and no others.

/** What the cut is called, when the group has no name of its own. */
const UNNAMED: Record<Dimension, string> = {
  members: 'Outside your view',
  projects: 'No project reported',
  devices: 'No device reported',
}

const NOTHING: Record<Dimension, string> = {
  members: 'No Turns from this person in this period.',
  projects: 'No Turns from this Project in this period.',
  devices: 'No Turns from this Device in this period.',
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
  const before = cursorOf(query.before)

  // `id` rather than `groupId` for a Member: the caller has refused `none`
  // for one, and the filter type says the absent group is not expressible.
  const filter: TurnFilter =
    dimension === 'members'
      ? { kind: 'members', id }
      : { kind: dimension, id: groupId }

  // Ticket 90: only a Project can be named, and only an Owner or Admin may —
  // so nobody else pays for the statement.
  const naming = dimension === 'projects' && groupId !== null
  const [cut, page, nickname] = await asViewer(viewer.userId, (tx) =>
    Promise.all([
      // The group's own totals, read by name rather than summed from the page
      // below: the page is capped, and a total summed from a capped list drops
      // the tail without saying so.
      breakdown(
        tx,
        viewer.orgId,
        viewer.orgTimezone,
        resolved.range,
        dimension,
        { id: groupId },
      ),
      turnList(tx, viewer.orgId, filter, {
        timezone: viewer.orgTimezone,
        range: resolved.range,
        before,
      }),
      naming ? projectNickname(tx, groupId) : Promise.resolve(null),
    ]),
  )

  const [row] = cut.rows
  const label = row?.label ?? UNNAMED[dimension]
  const last = page.turns.at(-1)
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
      {compact.format(row.tokens)} tokens · {row.turns}{' '}
      {row.turns === 1 ? 'Turn' : 'Turns'}
      {row.unpricedTurns > 0 ? `, ${row.unpricedTurns} unpriced` : ''} in this
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

      <SectionBreak>Turns</SectionBreak>
      <TurnRows
        turns={page.turns}
        timezone={viewer.orgTimezone}
        empty={NOTHING[dimension]}
      />

      {/* A cursor rather than an offset: a page boundary that repeats or
          skips a row is worse than no paging at all. It opens the cut's own
          page, which is where a long list belongs. */}
      {page.more && last ? (
        <p className="mt-3 text-body">
          <Link
            href={hrefWith(path, query, {
              open: undefined,
              view: undefined,
              before: `${last.occurredAt},${last.id}`,
            })}
            className="text-text-muted hover:text-text"
          >
            Older Turns ›
          </Link>
        </p>
      ) : null}
    </div>
  )
}

/** `<iso>,<id>`, or nothing. Anything else shows the first page. */
const cursorOf = (
  value: string | string[] | undefined,
): TurnCursor | undefined => {
  const [at, id] = (one(value) ?? '').split(',')
  if (!at || !id || !/^\d+$/.test(id)) return undefined
  return Number.isNaN(Date.parse(at)) ? undefined : { occurredAt: at, id }
}
