'use client'

import { DEMO_DIGEST, DEMO_REFUSAL } from '../../lib/demo'

// The error state the wireframes draw: "What failed, in one sentence, and a
// retry control. The rest of the page stays where it is, so the reader does
// not lose their place."
//
// It is a client module because Next requires an error boundary to be one, and
// because `reset` is a function the browser calls. It renders inside the
// shell, so the navigation and the Org name are still on the screen — the
// reader has lost the content column, not the product.
//
// The message is ours and never the exception's: a Postgres error names a
// table and sometimes a value, and neither belongs on a page. `digest` is the
// handle a deployment's own logs are searched by, which is why it is the one
// detail shown.

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  // Ticket 137: a demo write the database refused, from an action with no
  // error channel of its own. Not a failure, so not the failure's colours.
  if (error.digest === DEMO_DIGEST) {
    return (
      <div
        role="status"
        className="border-rule bg-surface rounded-md border p-6"
      >
        <h1 className="text-heading">{DEMO_REFUSAL}</h1>
        <p className="text-text-secondary mt-2 text-body">
          Sign up to try it with your own team&apos;s data.
        </p>
        <button
          type="button"
          onClick={reset}
          className="bg-accent-fill text-accent-on-fill mt-4 h-[var(--control-h)] rounded-md px-4 text-body"
        >
          Back to the page
        </button>
      </div>
    )
  }

  return (
    <div className="border-bad-border bg-bad-bg rounded-md border p-6">
      <h1 className="text-heading">This did not load.</h1>
      <p className="text-text-secondary mt-2 text-body">
        Something failed while reading your Org&apos;s data. Nothing was
        changed, and trying again is safe.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="bg-accent-fill text-accent-on-fill h-[var(--control-h)] rounded-md px-4 text-body"
        >
          Try again
        </button>
        {error.digest ? (
          <span className="text-text-muted font-mono text-caption">
            {error.digest}
          </span>
        ) : null}
      </div>
    </div>
  )
}
