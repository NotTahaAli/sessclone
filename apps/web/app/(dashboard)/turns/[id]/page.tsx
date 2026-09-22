import Link from 'next/link'
import { notFound } from 'next/navigation'

import { TurnBreakdown, TurnFacts } from '../turn-breakdown'
import { PageHeader } from '../../page-header'
import { asViewer } from '../../../../lib/db'
import { turnDetail } from '../../../../lib/turns'
import { currentViewer } from '../../../../lib/viewer'

// Ticket 88's second level: one Turn, and every quantity it recorded.
//
// Reached from both lists that show a Turn — the Costs drill-down and a
// Session's detail — which is why the components are in the directory above
// rather than in this file.
//
// The authorisation is `turns_read` and nothing else. `turnDetail` filters on
// the id and the Org, so a Turn outside the viewer's set is no row and this
// answers 404 — the same refusal as a Turn that does not exist, because a
// distinguishable one would confirm that a Turn somebody cannot see is there.

const when = (timezone: string) =>
  new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'full',
    timeStyle: 'medium',
    timeZone: timezone,
  })

export default async function Turn({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const viewer = await currentViewer()
  if (!viewer) return null

  const { id } = await params
  // `turns.id` is a bigint and the statement casts to one, so anything that is
  // not digits would be a cast error rather than an empty result. Refuse it
  // here instead: a hand-typed URL is a 404, not a 500.
  if (!/^\d+$/.test(id)) notFound()

  const detail = await asViewer(viewer.userId, (tx) =>
    turnDetail(tx, viewer.orgId, id),
  )
  if (!detail) notFound()

  const { row, facts } = detail

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="One Turn"
        description={`${when(viewer.orgTimezone).format(
          new Date(row.occurredAt),
        )}${facts.memberEmail ? ` · ${facts.memberEmail}` : ''}${
          facts.deviceLabel ? ` · ${facts.deviceLabel}` : ''
        }`}
      />

      {/* Back to the Session this Turn is part of, which is the question a
          reader has next about a figure they just looked up. */}
      <p className="text-body">
        <Link
          href={`/sessions/${encodeURIComponent(row.sessionId)}?member=${facts.memberId}`}
          className="text-accent-text underline"
        >
          The whole session
        </Link>
        <span className="text-text-muted font-mono break-all">
          {' · '}
          {row.sessionId}
          {row.agentId ? ` · subagent ${row.agentId}` : ''}
        </span>
      </p>

      <TurnBreakdown detail={detail} />
      <TurnFacts detail={detail} />
    </div>
  )
}
