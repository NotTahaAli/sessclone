import { cacheLife, cacheTag } from 'next/cache'
import type { TransactionSql } from 'postgres'

import { breakdown, type Dimension } from './breakdown'
import { asViewer, pageSeenAt } from './db'
import { DEMO_CACHE_TAG, DEMO_USER_ID, isDemoUser } from './demo'
import { demoWindow } from './demo-data'
import { countFailures, sessionFailures } from './failures'
import { onboardingFacts } from './onboarding'
import type { ResolvedRange } from './range'
import { dailySpend } from './series'
import {
  sessionFilters,
  sessionList,
  type SessionCursor,
  type SessionFilter,
} from './sessions'

// Ticket 137: the dashboard's heaviest reads, cached for the demo visitor and
// for nobody else.
//
// The demo's Costs and Sessions each took about 1.1s a load, the same on the
// second load as on the first, though its data changes once a day. Every
// visitor sees the same rows, so one cache entry per (read, arguments, demo
// day) serves them all, and the refresh expires the lot by tag when it seeds.
//
// Isolation is structural rather than a check inside the cache:
//
// - The cached reads run as `DEMO_USER_ID`, never as a caller's id, so an
//   entry holds only what the policies show the demo visitor, whoever asked.
// - `costsReads` and `sessionsReads` send anybody else straight to
//   `asViewer`, uncached, so a real user's rows are never written to the
//   cache and never read from it.

type LocalRange = ResolvedRange['range']

type CostsArgs = {
  orgId: string
  memberId: string
  timezone: string
  range: LocalRange
  /** The reads the view needs beside the facts and the failures count. */
  time: boolean
  dimension: Dimension | null
  failures: boolean
}

type SessionsArgs = {
  orgId: string
  timezone: string
  range: LocalRange
  filter: SessionFilter
  before: SessionCursor | undefined
}

/** Costs, in one transaction: the reads are independent, so they go
 * together. `seenAt` comes first, from the database's clock: the Costs page
 * says why. */
const costs = async (tx: TransactionSql, args: CostsArgs) => {
  const { orgId, memberId, timezone, range } = args
  const seenAt = await pageSeenAt(tx)
  const reads = await Promise.all([
    onboardingFacts(tx, orgId),
    args.time ? dailySpend(tx, orgId, timezone, range) : null,
    args.dimension
      ? breakdown(tx, orgId, timezone, range, args.dimension)
      : null,
    countFailures(tx, orgId, memberId, timezone, range),
    args.failures
      ? sessionFailures(tx, orgId, memberId, timezone, range)
      : null,
  ])
  return [seenAt, reads] as const
}

/** The Sessions list and its filter menus. */
const sessions = (tx: TransactionSql, args: SessionsArgs) =>
  Promise.all([
    sessionList(tx, args.orgId, args.timezone, args.range, args.filter, {
      before: args.before,
    }),
    sessionFilters(tx, args.orgId),
  ])

/** The newest day the refresh has seeded, which turns the cache over. */
const demoCacheDay = (now: Date) => demoWindow(now).at(-1) ?? ''

/** Marks a demo entry: a day's life, since the data changes daily, and the
 * tag the refresh expires. The key is the arguments, the Org and the demo
 * day among them. */
const demoEntry = (day: string) => {
  cacheLife('days')
  cacheTag(DEMO_CACHE_TAG, `${DEMO_CACHE_TAG}:${day}`)
}

// Both cached reads are the demo visitor's, never a caller's: see the note at
// the top.
async function demoCosts(args: CostsArgs, day: string) {
  'use cache'
  demoEntry(day)
  return asViewer(DEMO_USER_ID, (tx) => costs(tx, args))
}

async function demoSessions(args: SessionsArgs, day: string) {
  'use cache'
  demoEntry(day)
  return asViewer(DEMO_USER_ID, (tx) => sessions(tx, args))
}

/** Costs as `userId`: cached for the demo visitor, live for anybody else. */
export const costsReads = (
  userId: string,
  args: CostsArgs,
  now = new Date(),
) =>
  isDemoUser(userId)
    ? demoCosts(args, demoCacheDay(now))
    : asViewer(userId, (tx) => costs(tx, args))

/** Sessions as `userId`: cached for the demo visitor, live for anybody
 * else. */
export const sessionsReads = (
  userId: string,
  args: SessionsArgs,
  now = new Date(),
) =>
  isDemoUser(userId)
    ? demoSessions(args, demoCacheDay(now))
    : asViewer(userId, (tx) => sessions(tx, args))
