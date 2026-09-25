import { finalizeDueDeletions } from '../../../../lib/account-deletion'
import { presentedBearer, secretMatches } from '../../../../lib/bearer'
import { ingestDb } from '../../../../lib/collector-auth'
import { expiredCount, sweepRetention } from '../../../../lib/retention'
import { storageConfigured } from '../../../../lib/storage'
import { removeSignIn } from '../../../../lib/supabase/admin'

// Ticket 61: the endpoint that enforces Retention.
//
// A route rather than a schedule, because this deployment has no scheduler and
// a self-hoster's is their own — cron, a platform's scheduled job, a CI
// workflow, `curl` from a laptop. What the product owes them is an idempotent
// call that can be made as often as they like, and that is what this is:
// nothing is past its window twice.
//
// A shared secret rather than a session, for the same reasons as the pricing
// route beside it: the caller is a program, the comparison is constant time,
// and a deployment that has not set a secret refuses every call rather than
// leaving a destructive endpoint open. This one destroys transcripts, so that
// default matters more here than there.
//
// It runs as the owning role. Retention crosses every Org on the deployment,
// while `log_artifacts_delete` is deliberately the Member's own rows alone
// (ADR 0005), so there is no viewer this could run as — which is exactly why
// it is a secret-gated route and not a Server Action.

export async function POST(request: Request) {
  const expected = process.env.RETENTION_SWEEP_SECRET
  if (!expected) {
    return Response.json(
      { error: 'this deployment has no retention sweep secret' },
      { status: 503 },
    )
  }

  if (!secretMatches(presentedBearer(request), expected)) {
    return Response.json({ error: 'not authorised' }, { status: 401 })
  }

  // Ticket 141: account deletions past their grace ride the same daily call
  // rather than a second cron and a second secret. First, and before the
  // storage check: the scrub queues a person's transcripts as orphans, which
  // the sweep below then deletes, and a deployment without storage still
  // owes its people their deletion.
  const accounts = await finalizeDueDeletions(ingestDb(), removeSignIn)

  // Storage first: the rows and the objects go together, so a sweep that
  // cannot reach the bucket must not delete rows — that is the one failure
  // that leaves a transcript nobody can find and nobody can delete.
  if (!storageConfigured()) {
    return Response.json(
      { error: 'this deployment has no storage configured' },
      { status: 503 },
    )
  }

  const sql = ingestDb()

  try {
    const swept = await sweepRetention(sql)
    return Response.json({
      removed: swept.removed,
      accounts: {
        scrubbed: accounts.scrubbed,
        signInsRemoved: accounts.signInsRemoved,
        signInsFailed: accounts.failed.length,
      },
      // What is still past the window after this call, so a caller draining a
      // backlog knows to call again rather than guessing from `more`.
      remaining: swept.more ? await expiredCount(sql) : 0,
    })
  } catch {
    // A storage failure rolled the rows back, so the deployment is unchanged
    // and the answer is "try again" rather than a partial success nobody can
    // reconstruct. The cause stays on the server: a bucket name, an endpoint
    // or a key fragment in the body is more than the caller needs, and the
    // other secret-gated route does not do it either.
    return Response.json(
      { error: 'the sweep did not complete; nothing was removed' },
      { status: 503 },
    )
  }
}

// Vercel Cron calls the production URL with GET and `Authorization: Bearer
// $CRON_SECRET`, so on Vercel set `CRON_SECRET` to the same value as
// `RETENTION_SWEEP_SECRET`; `apps/web/vercel.json` holds the schedule. The same
// secret gates both methods, so GET opens nothing POST did not.
export const GET = POST
