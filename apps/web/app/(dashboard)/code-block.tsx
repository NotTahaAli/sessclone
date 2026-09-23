'use client'

import { useCallback, useState } from 'react'

// CodeBlock and CopyButton, from the design system's inventory, both first
// needed at ticket 45 for the Collector install path.
//
// A client module because copying is a browser capability and nothing else
// here is. The command itself is rendered by the server into the markup, so a
// reader with no JavaScript sees the command and can select it — they lose the
// button, not the instructions.

export function CodeBlock({
  command,
  label,
}: {
  command: string
  /** What the button announces, since several blocks share a surface. */
  label: string
}) {
  const [copied, setCopied] = useState(false)

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      // No timer to clear: the confirmation stays until the next copy. A
      // `setTimeout` here is a timer running against an unmounted component
      // the moment the reader navigates away (AGENTS.md).
    } catch {
      // Denied clipboard permission, or an insecure origin. The command is on
      // the screen either way, so there is nothing to report.
      setCopied(false)
    }
  }, [command])

  return (
    <div className="border-rule bg-surface flex items-center gap-2 rounded-lg border py-1.5 pr-1.5 pl-2">
      <code className="text-text grow overflow-x-auto px-1 text-caption whitespace-pre">
        {command}
      </code>
      <button
        type="button"
        onClick={copy}
        className="border-rule text-text hover:bg-surface-hover h-[var(--pill-h)] shrink-0 rounded-full border px-3 text-caption"
      >
        {/* Text as well as colour: the design system says the confirmation is
            both, so a monochrome display still reports it. */}
        {copied ? 'Copied' : 'Copy'}
        <span className="sr-only"> {label}</span>
      </button>
    </div>
  )
}
