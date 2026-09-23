'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { pillClass } from '../_ui/primitives'

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
    <div className="bg-surface border-rule flex items-center justify-between gap-3 rounded-[10px] border py-2 pr-2 pl-3">
      <div className="flex min-w-0 flex-col overflow-x-auto font-mono text-caption leading-[1.8] whitespace-nowrap">
        {commands.map((command) => (
          <code key={command}>
            <span className="text-text-muted">$ </span>
            {command}
          </code>
        ))}
      </div>
      <button type="button" onClick={copy} className={`${pillClass} shrink-0`}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}
