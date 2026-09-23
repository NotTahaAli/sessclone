'use client'

import Link from 'next/link'
import { useEffect, useSyncExternalStore } from 'react'

import { buttonClass } from '../_ui/primitives'

// Microsoft Clarity, on the marketing pages only (Taha, 2026-09-23): never
// the dashboard, whose pages hold transcripts and costs. Nothing loads until a
// deployment sets its project id.
//
// Visitors in Europe are asked first. Since 2025-10-31 Clarity wants a consent
// signal for the EEA, the UK and Switzerland
// (https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-consent-api-v2),
// and here "no" means the script never loads at all, which is stricter than
// Clarity's own cookieless mode. Everywhere else it loads without asking.
// The answer is kept in this browser only.

const KEY = 'sessclone-analytics-consent'

/** The marketing pages; leaving them is what `useClarity`'s cleanup checks. */
const MARKETING = new Set(['/', '/pricing', '/privacy', '/terms'])

/**
 * Whether a visitor in this time zone gets asked. The time zone is all a
 * statically rendered page knows without a request header.
 * ponytail: time zone, not IP: a VPN or a travelling laptop guesses wrong.
 * It errs towards asking (all of Europe/, not only the EEA); move to the
 * host's country header if a real geo signal is ever needed.
 */
export const asksConsent = (timeZone: string) =>
  /^(?:Europe|Arctic)\/|^Atlantic\/(?:Reykjavik|Canary|Madeira|Azores)$|^Asia\/(?:Nicosia|Famagusta)$/.test(
    timeZone,
  )

type Clarity = ((...args: unknown[]) => void) & { q?: unknown[][] }
declare global {
  interface Window {
    clarity?: Clarity
  }
}

const ID = process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID

const read = () => {
  try {
    return window.localStorage.getItem(KEY)
  } catch {
    return null
  }
}

// The answer lives in localStorage, and the time zone decides whether there is
// a question at all; both exist only in the browser, so this reads them as an
// external store. The server has neither and renders nothing.
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
const snapshot = () => {
  const answer = read()
  if (answer === 'granted' || answer === 'denied') return answer
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return asksConsent(zone) ? 'ask' : 'granted'
}
const serverSnapshot = () => 'unknown'

const answer = (value: 'granted' | 'denied') => {
  try {
    window.localStorage.setItem(KEY, value)
  } catch {
    // Private mode or blocked storage: the answer lasts this page view.
  }
  for (const listener of listeners) listener()
}
const allow = () => answer('granted')
const decline = () => answer('denied')

// The official snippet, unrolled: queue calls until the tag arrives.
const queue: Clarity = (...args) => {
  ;(queue.q ??= []).push(args)
}
const load = (id: string) => {
  if (window.clarity) return
  window.clarity = queue
  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.clarity.ms/tag/${encodeURIComponent(id)}`
  document.head.append(script)
  queue('consentv2', { ad_Storage: 'denied', analytics_Storage: 'granted' })
}

// Clarity has no documented way to stop, and a client-side link out of these
// pages would carry it into the dashboard. So leaving them after it loaded
// costs one full page load, which starts the next page without it. The path
// check keeps React's development double-run from reloading.
const leave = () => {
  if (window.clarity && !MARKETING.has(window.location.pathname)) {
    window.location.reload()
  }
}

export function ClarityAnalytics() {
  const state = useSyncExternalStore(subscribe, snapshot, serverSnapshot)

  useEffect(() => {
    if (ID && state === 'granted') load(ID)
    return leave
  }, [state])

  if (!ID || state !== 'ask') return null

  return (
    <div
      role="dialog"
      aria-label="Analytics cookies"
      className="border-rule bg-surface text-text fixed inset-x-4 bottom-4 z-50 mx-auto max-w-[34rem] rounded-xl border p-4 shadow-lg"
    >
      <p className="text-text-secondary text-body">
        May we use Microsoft Clarity to see how people use these pages? It sets
        cookies. The dashboard never loads it.{' '}
        <Link href="/privacy" className="text-text underline">
          Privacy
        </Link>
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" className={buttonClass()} onClick={decline}>
          No thanks
        </button>
        <button
          type="button"
          className={buttonClass('primary')}
          onClick={allow}
        >
          Allow
        </button>
      </div>
    </div>
  )
}
