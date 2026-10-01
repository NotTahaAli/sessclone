'use client'

import { useActionState, useCallback, useState } from 'react'

import { createKey } from './actions'
import {
  Button,
  buttonClass,
  cardClass,
  inputClass,
  SectionBreak,
} from '../../_ui/primitives'
import { CodeBlock } from '../code-block'
import {
  installCommand,
  MARKETPLACE_COMMAND,
} from '../../../lib/install-command'

// The one client component on this page, and it is client-side for exactly one
// reason: the new key lives in `useActionState`'s return value and nowhere
// else. A Server Component cannot hold it — there is nothing to re-read it
// from on the next render, which is the point.

export function NewKeyForm({
  appUrl,
  orgId,
}: {
  /** The Org this page shows; the action refuses any other (a stale tab). */
  orgId: string
  /** This deployment's own URL, so the command below is ready to run. */
  appUrl: string
}) {
  const [state, formAction, pending] = useActionState(createKey, null)

  return (
    <section aria-labelledby="create-key">
      <SectionBreak>
        <span id="create-key">Create a key</span>
      </SectionBreak>

      {/* Direction A's field: one round input and the primary button beside
          it. The key reports to the current Org; the Org switcher is how
          somebody in two makes one for the other. */}
      <form action={formAction} className="flex flex-wrap gap-1.5 py-1">
        <input type="hidden" name="orgId" value={orgId} />
        <label htmlFor="label" className="sr-only">
          Label
        </label>
        <input
          id="label"
          name="label"
          required
          maxLength={80}
          placeholder="Label, like work laptop"
          className={`${inputClass} min-w-40 flex-1`}
        />
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Creating…' : 'Create key'}
        </Button>
      </form>

      {state && 'error' in state ? (
        <p role="alert" className="text-bad-text mt-2 text-caption">
          {state.error}
        </p>
      ) : null}

      {state && 'key' in state ? (
        <Revealed apiKey={state.key} appUrl={appUrl} />
      ) : null}
    </section>
  )
}

/**
 * Shown once, on the render that created it. Navigating away or reloading
 * loses it, and that is not a bug to fix later — nothing stored it.
 */
export function Revealed({
  apiKey,
  appUrl,
}: {
  apiKey: string
  appUrl: string
}) {
  const [copied, setCopied] = useState(false)

  const copy = useCallback(() => {
    // Unavailable over plain HTTP and refusable by the browser, so the key
    // stays on screen to select by hand either way.
    navigator.clipboard?.writeText(apiKey).then(
      () => setCopied(true),
      () => setCopied(false),
    )
  }, [apiKey])

  return (
    <div role="status" className={`${cardClass} mt-3`}>
      <p className="text-text text-sm font-medium">
        Copy this key now. It is not stored and cannot be shown again.
      </p>
      <p className="text-text-secondary mt-1 text-sm">
        For a cloud environment, this key is the API credential&apos;s value:
        see the Cloud environment tab below.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <code className="bg-surface-hover text-text rounded-md px-3 py-2 font-mono text-sm break-all">
          {apiKey}
        </code>
        <button type="button" onClick={copy} className={buttonClass()}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      {/* The whole setup, in order, on the one render that has the key
          (Taha, 2026-09-22; ticket 147). Everywhere else the same command
          carries a placeholder, because nothing stores a key to put here.
          Step 1 used to live only in the panel below the key list, which a
          first-time reader on a phone never scrolled to before running step
          2.

          The caveat is not hidden: a command carries its argument into shell
          history, so the prompt route is named right beside it for anybody
          who would rather it did not. */}
      <ol className="mt-4 flex flex-col gap-3">
        <li>
          <p className="text-text text-sm font-medium">
            1. Add the marketplace
          </p>
          <div className="mt-1.5">
            <CodeBlock
              command={MARKETPLACE_COMMAND}
              label="the marketplace command"
            />
          </div>
        </li>
        <li>
          <p className="text-text text-sm font-medium">
            2. Install the Collector with this key
          </p>
          <div className="mt-1.5">
            <CodeBlock
              command={installCommand(appUrl, apiKey)}
              label="the install command"
            />
          </div>
          <p className="text-text-secondary mt-1.5 text-sm">
            This keeps the key in your shell&apos;s history. To avoid that, run{' '}
            <code className="font-mono">/plugin install sessclone</code> inside
            Claude Code and paste the key at its prompt.
          </p>
        </li>
        <li>
          <p className="text-text text-sm font-medium">
            3. Restart Claude Code
          </p>
          <p className="text-text-secondary mt-0.5 text-sm">
            Your first Turn shows on Costs a moment after Claude Code next
            answers.
          </p>
        </li>
      </ol>
    </div>
  )
}
