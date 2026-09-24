'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { listFiles, wholeStream } from './data'

// Ticket 133, ADR 0008: a chunked transcript downloads as one plain `.jsonl`,
// assembled here from its presigned chunk and tail URLs, so no byte passes
// through the application. A zero-chunk row keeps ticket 60's 302 link.

/** Chromium streams to disk through the save picker; the rest build a Blob. */
export const saveMethod = (scope: object): 'picker' | 'blob' =>
  typeof Reflect.get(scope, 'showSaveFilePicker') === 'function'
    ? 'picker'
    : 'blob'

/** The name ticket 60's 302 gives the same transcript. */
export const downloadName = (sessionId: string, agentId: string | null) =>
  agentId ? `${sessionId}-agent-${agentId}.jsonl` : `${sessionId}.jsonl`

declare global {
  interface Window {
    /** Chromium's File System Access API; absent from Firefox and Safari. */
    showSaveFilePicker?: (options: {
      suggestedName: string
    }) => Promise<FileSystemFileHandle>
  }
}

/** How long a Blob's URL outlives its click, so the browser can read it. */
const REVOKE_AFTER_MS = 10_000

export function DownloadTranscript({
  sessionId,
  memberId,
  agentId,
  className,
  label,
}: {
  sessionId: string
  memberId: string
  agentId: string | null
  className: string
  label: string
}) {
  const [state, setState] = useState<'idle' | 'busy' | { error: string }>(
    'idle',
  )
  const controller = useRef<AbortController | null>(null)
  const revoke = useRef<{ timer: number; url: string } | null>(null)

  useEffect(
    () => () => {
      controller.current?.abort()
      if (revoke.current) {
        window.clearTimeout(revoke.current.timer)
        URL.revokeObjectURL(revoke.current.url)
      }
    },
    [],
  )

  const download = useCallback(async () => {
    controller.current?.abort()
    const current = new AbortController()
    controller.current = current
    const { signal } = current
    const name = downloadName(sessionId, agentId)
    setState('busy')
    try {
      // The picker first: it needs the click's user activation, which the
      // list fetch below would outlive.
      const handle =
        saveMethod(window) === 'picker' && window.showSaveFilePicker
          ? await window.showSaveFilePicker({ suggestedName: name })
          : null

      const find = async () => {
        const list = await listFiles(sessionId, memberId, signal)
        if (list.status === 'error') throw new Error(list.message)
        return list.status === 'ready'
          ? (list.files.find(
              (file) => file.kind === 'transcript' && file.agentId === agentId,
            ) ?? null)
          : null
      }
      const file = await find()
      if (!file) throw new Error('This transcript is no longer stored.')
      const stream = wholeStream(file, find, signal)

      if (handle) {
        // A failed chunk errors the stream, and pipeTo then aborts the
        // writable, which discards the partial file rather than keeping it.
        await stream.pipeTo(await handle.createWritable(), { signal })
      } else {
        // ponytail: holds the whole raw transcript in memory (Taha accepted
        // this for Firefox and Safari); a service-worker stream is the
        // upgrade if a transcript is measured to be too big for it.
        const url = URL.createObjectURL(await new Response(stream).blob())
        const link = document.createElement('a')
        link.href = url
        link.download = name
        link.click()
        if (revoke.current) {
          window.clearTimeout(revoke.current.timer)
          URL.revokeObjectURL(revoke.current.url)
        }
        revoke.current = {
          url,
          timer: window.setTimeout(() => {
            URL.revokeObjectURL(url)
            revoke.current = null
          }, REVOKE_AFTER_MS),
        }
      }
      if (!signal.aborted) setState('idle')
    } catch (failure) {
      if (signal.aborted) return
      // Closing the save picker is a choice, not a failure.
      if (failure instanceof DOMException && failure.name === 'AbortError') {
        setState('idle')
        return
      }
      setState({
        error:
          failure instanceof Error ? failure.message : 'It did not download.',
      })
    }
  }, [sessionId, memberId, agentId])
  const onClick = useCallback(() => void download(), [download])

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={state === 'busy'}
        aria-label={label}
        className={`${className} disabled:opacity-50`}
      >
        {state === 'busy' ? 'Downloading…' : 'Download'}
      </button>
      {typeof state === 'object' ? (
        <span role="alert" className="text-bad-text">
          The download failed. {state.error}
        </span>
      ) : null}
    </>
  )
}
