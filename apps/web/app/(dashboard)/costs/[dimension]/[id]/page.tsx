import Link from 'next/link'
import { notFound } from 'next/navigation'

import { renameProjectAction } from './actions'
import { RangeControl } from '../../range-control'
import { InlineName } from '../../../inline-name'
import { viewHref } from '../../views'
import { TurnRows } from '../../../turns/turn-row'
import { PageHeader } from '../../../page-header'
import { asViewer } from '../../../../../lib/db'
import { breakdown, type Dimension } from '../../../../../lib/breakdown'
import { resolveRange, type RangeParams } from '../../../../../lib/range'
import {
  turnList,
  type TurnCursor,
  type TurnFilter,
} from '../../../../../lib/turns'
import { compact, usd } from '../../../../../lib/money'
import { projectNickname } from '../../../../../lib/names'
import { currentViewer, reachesOrgSettings } from '../../../../../lib/viewer'

// Ticket 88's first level: a ranked row was a dead end, and this is what is
// under it.
//
// The URL carries the cut in the path and the period in the query, so the two
// behave the way they do everywhere else in Costs: `/costs/projects/<id>` is
// the row, `?range=last-30` is the period, and the range control here is the
// same component the Costs page renders, writing back to this path.
//
// `none` is the group with no id — the Turns that reported no Project or no
// Device. It is a group rather than a gap, and the same spelling the
// transcripts pages already use for it.
//
// The Role scoping is the policies' (ADR 0001) and nothing on this page. A
// Member opening a link to another Member's cut sees their own Turns in it,
// because `turns_read` hands them their own and no others.

const DIMENSIONS: Dimension[] = ['members', 'projects', 'devices']

const isDimension = (value: string): value is Dimension =>
  DIMENSIONS.some((dimension) => dimension === value)

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

type Params = RangeParams & { before?: string | string[] }

export default async function Cut({
  params,
  searchParams,
}: {
  params: Promise<{ dimension: string; id: string }>
  searchParams: Promise<Params>
}) {
  const viewer = await currentViewer()
  if (!viewer) return null

  const { dimension, id } = await params
  if (!isDimension(dimension)) notFound()

  // `none` is the absent group. A Member has no absent group — `member_id` is
  // `not null` — so the one cut that cannot be asked for is refused rather
  // than silently answered with everything.
  const groupId = id === 'none' ? null : id
  if (groupId === null && dimension === 'members') notFound()

  const query = await searchParams
  const resolved = resolveRange(query, viewer.orgTimezone)
  const before = cursorOf(query.before)

  // `id` rather than `groupId` for a Member, which the refusal above has
  // already established is not `none`: the two branches differ only in whether
  // the absent group is expressible, and the filter type says so.
  const filter: TurnFilter =
    dimension === 'members'
      ? { kind: 'members', id }
      : { kind: dimension, id: groupId }

  // Ticket 90: the box on this page prefills with the name itself, so it has
  // to know whether the label above it is a name or a key. Only a Project can
  // be named, and only an Owner or Admin may — so nobody else pays for the
  // statement.
  const naming = dimension === 'projects' && groupId !== null
  const [cut, page, nickname] = await asViewer(viewer.userId, (tx) =>
    Promise.all([
      // The group's own totals, read by name rather than summed from the page
      // below: the page is capped, and a total summed from a capped list drops
      // the tail without saying so — on a page about money, the worse failure.
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

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        description={
          row
            ? `${usd(row.costUsd)} · ${compact.format(row.tokens)} tokens · ${
                row.turns
              } ${row.turns === 1 ? 'Turn' : 'Turns'}${
                row.unpricedTurns > 0 ? `, ${row.unpricedTurns} unpriced` : ''
              } in this period.`
            : 'Nothing in this period.'
        }
      >
        {/* Ticket 90: a Project can be named, and only an Owner or an Admin
            may. Everybody else reads the label the breakdown gave it. */}
        {naming && reachesOrgSettings(viewer.role) ? (
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
        )}
      </PageHeader>

      <p className="text-body">
        <Link
          href={viewHref('/costs', dimension, query)}
          className="text-accent-text underline"
        >
          Back to {dimension === 'members' ? 'People' : `the ${dimension}`}
        </Link>
      </p>

      <RangeControl
        path={`/costs/${dimension}/${id}`}
        resolved={resolved}
        view={undefined}
      />

      <div className="border-rule bg-surface rounded-md border p-2">
        <TurnRows
          turns={page.turns}
          timezone={viewer.orgTimezone}
          empty={NOTHING[dimension]}
        />
      </div>

      {/* A cursor rather than an offset, for the reason the transcripts
          listing gives: a page boundary that repeats or skips a row is worse
          than no paging at all. */}
      {page.more && last ? (
        <p>
          <Link
            href={`/costs/${dimension}/${id}?${nextPage(query, last)}`}
            className="text-accent-text underline"
          >
            Older Turns
          </Link>
        </p>
      ) : null}
    </div>
  )
}

/** The same query, plus the cursor: the period must survive the page turn. */
const nextPage = (query: Params, last: { occurredAt: string; id: string }) => {
  const search = new URLSearchParams()
  for (const key of ['range', 'from', 'to'] as const) {
    const value = one(query[key])
    if (value) search.set(key, value)
  }
  search.set('before', `${last.occurredAt},${last.id}`)
  return search.toString()
}

const one = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value

/** `<iso>,<id>`, or nothing. Anything else shows the first page. */
const cursorOf = (
  value: string | string[] | undefined,
): TurnCursor | undefined => {
  const [at, id] = (one(value) ?? '').split(',')
  if (!at || !id || !/^\d+$/.test(id)) return undefined
  return Number.isNaN(Date.parse(at)) ? undefined : { occurredAt: at, id }
}
