import { notFound } from 'next/navigation'

import { Cut } from './cut'
import type { Dimension } from '../../../../../lib/breakdown'
import { resolveRange, type RangeParams } from '../../../../../lib/range'
import { currentViewer } from '../../../../../lib/viewer'

// Ticket 88's first level: a ranked row was a dead end, and this is what is
// under it.
//
// The URL carries the cut in the path and the period in the query, so the two
// behave the way they do everywhere else in Costs: `/costs/projects/<id>` is
// the row, `?range=last-30` is the period, and the period pill here writes
// back to this path.
//
// `none` is the group with no id — the Turns that reported no Project or no
// Device. It is a group rather than a gap, and the same spelling the
// transcripts pages already use for it.
//
// Since ticket 112 the same cut also opens as a column beside the Costs list
// on desktop; `cut.tsx` draws both.

const DIMENSIONS: Dimension[] = ['members', 'projects', 'devices']

const isDimension = (value: string): value is Dimension =>
  DIMENSIONS.some((dimension) => dimension === value)

type Params = RangeParams & { before?: string | string[] }

export default async function CutPage({
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

  // A Member has no absent group — `member_id` is `not null` — so the one cut
  // that cannot be asked for is refused rather than silently answered with
  // everything.
  if (id === 'none' && dimension === 'members') notFound()

  const query = await searchParams
  return (
    <div className="max-w-3xl">
      <Cut
        viewer={viewer}
        dimension={dimension}
        id={id}
        resolved={resolveRange(query, viewer.orgTimezone)}
        query={query}
      />
    </div>
  )
}
