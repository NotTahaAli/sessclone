'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// A client module because it is a control the visitor operates, and for no
// other reason: `'use client'` sits on the leaf and nowhere above it, so the
// hero around this stays server-rendered markup.
export function InstallCommand({ commands }: { commands: string[] }) {
  const [copied, setCopied] = useState(false)
  const reset = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Cleared on unmount, because a timer that outlives its component sets
  // state on a dead one — and because this page is the first surface anybody
  // sees, so its leak is the one that compounds.
  useEffect(() => () => clearTimeout(reset.current), [])

  // Memoised so the button does not take a new function on every render.
  //
  // `navigator.clipboard` is undefined outside a secure context — a LAN
  // preview, or a self-hosted deployment on plain HTTP, which is a tier this
  // very page sells. Optional chaining rather than a bare call, so the click
  // is a no-op with the commands still on screen to select by hand instead of
  // an unhandled rejection and a button that never answers.
  const copy = useCallback(() => {
    navigator.clipboard
      ?.writeText(commands.join('\n'))
      .then(() => {
        setCopied(true)
        reset.current = setTimeout(() => setCopied(false), 2000)
        return true
      })
      .catch(() => setCopied(false))
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
