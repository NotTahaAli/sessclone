'use client'

import { useActionState, useCallback, useState } from 'react'

import { createKey } from './actions'
import type { Membership } from '../../../lib/api-keys'
import { installCommand } from '../../../lib/install-command'

// The one client component on this page, and it is client-side for exactly one
// reason: the new key lives in `useActionState`'s return value and nowhere
// else. A Server Component cannot hold it — there is nothing to re-read it
// from on the next render, which is the point.

export function NewKeyForm({
  memberships,
  appUrl,
}: {
  memberships: Membership[]
  /** This deployment's own URL, so the command below is ready to run. */
  appUrl: string
}) {
  const [state, formAction, pending] = useActionState(createKey, null)

  // Only when there is a choice. One membership is the common case and a
  // one-option select is a control that asks a question with one answer.
  const choose = memberships.length > 1

  return (
    <section className="border-rule mt-8 border-t pt-6">
      <h2 className="text-text text-lg font-medium">Create a key</h2>

      <form action={formAction} className="mt-3 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="label" className="text-text-muted text-xs">
            Label
          </label>
          <input
            id="label"
            name="label"
            required
            maxLength={80}
            placeholder="work laptop"
            className="border-control-border bg-surface text-text rounded border px-3 py-2"
          />
        </div>
        {choose ? (
          <div className="flex flex-col gap-1">
            <label htmlFor="memberId" className="text-text-muted text-xs">
              Org
            </label>
            <select
              id="memberId"
              name="memberId"
              required
              defaultValue=""
              className="border-control-border bg-surface text-text rounded border px-3 py-2"
            >
              <option value="" disabled>
                Choose an org
              </option>
              {memberships.map((membership) => (
                <option key={membership.member_id} value={membership.member_id}>
                  {membership.org_name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="border-accent-border bg-accent-fill text-accent-on-fill rounded border px-3 py-2"
        >
          {pending ? 'Creating…' : 'Create key'}
        </button>
      </form>

      {state && 'error' in state ? (
        <p role="alert" className="text-bad-text mt-3 text-sm">
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
function Revealed({ apiKey, appUrl }: { apiKey: string; appUrl: string }) {
  const [copied, setCopied] = useState(false)
  const [copiedCommand, setCopiedCommand] = useState(false)
  const command = installCommand(appUrl, apiKey)

  const copy = useCallback(() => {
    // Unavailable over plain HTTP and refusable by the browser, so the key
    // stays on screen to select by hand either way.
    navigator.clipboard?.writeText(apiKey).then(
      () => setCopied(true),
      () => setCopied(false),
    )
  }, [apiKey])

  const copyCommand = useCallback(() => {
    navigator.clipboard?.writeText(command).then(
      () => setCopiedCommand(true),
      () => setCopiedCommand(false),
    )
  }, [command])

  return (
    <div
      role="status"
      className="border-ok-border bg-ok-bg mt-4 rounded border p-4"
    >
      <p className="text-text text-sm font-medium">
        Copy this key now. It is not stored and cannot be shown again.
      </p>
      <p className="text-text-secondary mt-1 text-sm">
        For a cloud environment, this key is the API credential&apos;s value:
        see the Cloud environment tab below.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <code className="border-rule bg-surface text-text rounded border px-3 py-2 font-mono text-sm break-all">
          {apiKey}
        </code>
        <button
          type="button"
          onClick={copy}
          className="border-control-border text-text rounded border px-3 py-2"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      {/* The install command with the key already in it, on the one render
          that has the key (Taha, 2026-09-22). Everywhere else the same
          command carries a placeholder, because nothing stores a key to put
          here — and a machine set up by one paste is the whole point of the
          `--config` flags. The marketplace command runs first, which the
          panel below this form spells out.

          The caveat is not hidden: a command carries its argument into shell
          history, so the prompt route is named right beside it for anybody
          who would rather it did not. */}
      <div className="mt-4">
        <p className="text-text text-sm font-medium">
          Or install the Collector in one command
        </p>
        <p className="text-text-secondary mt-1 text-sm">
          After <code className="font-mono">claude plugin marketplace add</code>
          , which is step 1 below. This has your key in it, so it will be kept
          in your shell&apos;s history; running{' '}
          <code className="font-mono">/plugin install sessclone</code> inside
          Claude Code asks for the key at a prompt instead.
        </p>
        <div className="border-rule bg-surface mt-2 flex items-center gap-2 rounded-md border p-2">
          <code className="text-text grow overflow-x-auto px-1 font-mono text-sm whitespace-pre">
            {command}
          </code>
          <button
            type="button"
            onClick={copyCommand}
            className="border-control-border text-text shrink-0 rounded border px-3 py-1 text-sm"
          >
            {copiedCommand ? 'Copied' : 'Copy'}
            <span className="sr-only"> the install command</span>
          </button>
        </div>
      </div>
    </div>
  )
}
