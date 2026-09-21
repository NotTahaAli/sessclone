'use client'

import { useCallback, useState } from 'react'

// A client module because it is a control the visitor operates, and for no
// other reason: `'use client'` sits on the leaf and nowhere above it, so the
// hero around this stays server-rendered markup.
export function InstallCommand({ commands }: { commands: string[] }) {
  const [copied, setCopied] = useState(false)

  // Memoised because the button would otherwise take a new function on every
  // render, which the lint rule this repo runs refuses. The commands are the
  // only thing it closes over and they never change after mount.
  const copy = useCallback(async () => {
    await navigator.clipboard.writeText(commands.join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [commands])

  return (
    <div className="border-rule-strong bg-surface flex flex-col gap-3 border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-figure flex flex-col gap-1 font-mono">
        {commands.map((command) => (
          <code key={command} className="break-all">
            <span className="text-text-muted">$ </span>
            {command}
          </code>
        ))}
      </div>
      <button
        type="button"
        onClick={copy}
        className="border-control-border text-label hover:bg-surface-hover h-[var(--control-h)] shrink-0 border px-4 font-mono uppercase"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}
