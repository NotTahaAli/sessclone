'use client'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'

import {
  NORMAL,
  parseJournal,
  parseLines,
  splitChunk,
  type Item,
  type JournalAgent,
  type Preset,
} from '@sessclone/shared'

import type { SavedPreset } from '../../../../../lib/view-presets'
import {
  columnWidths,
  MIN_WIDTH,
  readWidths,
  toggleColumn,
  type Column,
  type SavedWidths,
} from './columns'
import { AgentColumn, ColumnHeader, MainColumn, WorkflowColumn } from './column'
import { ColumnContext, ViewerContext, type Viewer } from './context'
import {
  listFiles,
  readBytes,
  readCosts,
  readItems,
  readText,
  type FileList,
  type StoredFile,
  type TurnCost,
} from './data'
import { FilterBar, type PresetActions } from './filter-bar'
import { clockFormat } from './format'

// Tickets 105-108: the transcript viewer. Finder-style columns: the Session on
// the left, and each subagent or workflow opened from a block to the right of
// the column the block sits in. At phone width the columns are 84% wide and
// snap, so the next one peeks in from the right, with a breadcrumb above them.
//
// Everything is read in the browser: the file list from our route, the bytes
// from storage through the presigned links it returns (ADR 0003). One load —
// the file list, the abort signal, and the per-file caches — lives until the
// next Reload, which aborts whatever is still in flight and starts afresh.

const WIDTHS_KEY = 'sessclone:transcript-widths'

/** One load of the file list, and what hangs off it until the next Reload. */
type Load = {
  status: 'ready'
  sessionId: string
  files: StoredFile[]
  signal: AbortSignal
  // Per file, for this load only, so bounded by the Session's file count
  // and dropped with the load.
  items: Map<string, Promise<Item[]>>
  journals: Map<string, Promise<JournalAgent[]>>
  costs: { promise: Promise<Record<string, TurnCost>> | null }
}

const MAIN: Column[] = [{ kind: 'main', key: 'main' }]

const titleOf = (column: Column) =>
  column.kind === 'main' ? 'Session' : column.title

const reduceMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function TranscriptViewer({
  sessionId,
  timezone,
  presets,
  actions,
  settingsHref,
}: {
  sessionId: string
  timezone: string
  /** The reader's saved presets; null when they could not be read. */
  presets: SavedPreset[] | null
  /** The preset Server Actions, or a harness's stand-ins. */
  actions: PresetActions | null
  /** Where a Member turns archival on. */
  settingsHref: string
}) {
  const [generation, setGeneration] = useState(0)
  const controller = useRef<AbortController | null>(null)
  const [state, setState] = useState<
    { status: 'loading' } | Exclude<FileList, { status: 'ready' }> | Load
  >({ status: 'loading' })
  const [saved, setSaved] = useState(presets)
  const [preset, setPreset] = useState<Preset>(() => {
    const own = presets?.find((one) => one.isDefault)
    return own ? { categories: own.categories, thinking: own.thinking } : NORMAL
  })
  const [columns, setColumns] = useState<Column[]>(MAIN)
  const [sessionStart, setSessionStart] = useState<string | null>(null)

  // The file list, once per Reload. Each load's controller aborts every read
  // made under it when the next Reload or an unmount replaces it.
  const start = useCallback(async () => {
    controller.current?.abort()
    const current = new AbortController()
    controller.current = current
    let next: typeof state
    try {
      const list = await listFiles(sessionId, current.signal)
      next =
        list.status === 'ready'
          ? {
              status: 'ready',
              sessionId,
              files: list.files,
              signal: current.signal,
              items: new Map(),
              journals: new Map(),
              costs: { promise: null },
            }
          : list
    } catch {
      next = {
        status: 'error',
        message: 'The list of stored files did not load.',
      }
    }
    if (!current.signal.aborted) setState(next)
  }, [sessionId])

  useEffect(() => {
    // State is set only after the list arrives, which is the external
    // system this effect synchronises with.
    // oxlint-disable-next-line react/set-state-in-effect
    void start()
    return () => controller.current?.abort()
  }, [start])

  const reload = useCallback(() => {
    setState({ status: 'loading' })
    setGeneration((was) => was + 1)
    void start()
  }, [start])

  const load = state.status === 'ready' ? state : null
  const main = load?.files.find(
    (file) => file.kind === 'transcript' && file.agentId === null,
  )
  const mainId = main?.id

  /**
   * A fresh link for one file, when storage refuses an expired one. Not
   * written back into the list: a later read of another expired link renews
   * for itself, which costs one small request and keeps the load immutable.
   */
  const signal = load?.signal
  const renew = useCallback(
    async (id: string) => {
      const list = await listFiles(sessionId, signal)
      return list.status === 'ready'
        ? (list.files.find((file) => file.id === id) ?? null)
        : null
    },
    [sessionId, signal],
  )

  // The Session's first timestamp, for "+4m into the session" in details.
  // The main column opens at the end, so this reads the first 64 KB apart.
  useEffect(() => {
    const file = load?.files.find((one) => one.id === mainId)
    if (!load || !file) return undefined
    let live = true
    void (async () => {
      try {
        const { bytes } = await readBytes(
          file,
          { start: 0, end: Math.max(0, Math.min(file.sizeBytes, 65536) - 1) },
          () => renew(file.id),
          load.signal,
        )
        const lines = splitChunk(bytes, 0, {
          atFileStart: true,
          atFileEnd: bytes.length >= file.sizeBytes,
        }).lines
        const first = parseLines(lines).find((item) => item.at)
        if (live) setSessionStart(first?.at ?? null)
      } catch {
        // Details go without "into the session"; nothing else depends on it.
      }
    })()
    return () => {
      live = false
    }
  }, [load, mainId, renew])

  const clock = useMemo(() => clockFormat(timezone), [timezone])

  const viewer = useMemo<Viewer>(() => {
    const find = (kind: StoredFile['kind'], agentId: string) =>
      load?.files.find((file) => file.kind === kind && file.agentId === agentId)
    return {
      clock,
      sessionStart,
      thinking: preset.thinking,
      showToolOutput: preset.categories.includes('tool_output'),
      transcriptFor: (agentId) => find('transcript', agentId),
      journalFor: (runId) => find('workflow_journal', runId),
      agentItems: (agentId) => {
        const file = find('transcript', agentId)
        if (!file || !load) return null
        let promise = load.items.get(file.id)
        if (!promise) {
          promise = readItems(file, () => renew(file.id), load.signal)
          load.items.set(file.id, promise)
        }
        return promise
      },
      journal: (runId) => {
        const file = find('workflow_journal', runId)
        if (!file || !load) return null
        let promise = load.journals.get(file.id)
        if (!promise) {
          promise = readText(file, () => renew(file.id), load.signal).then(
            parseJournal,
          )
          load.journals.set(file.id, promise)
        }
        return promise
      },
      costs: () => {
        if (!load) return Promise.reject(new Error('Not loaded yet.'))
        load.costs.promise ??= readCosts(load.sessionId, load.signal)
        return load.costs.promise
      },
      openAfter: (index) => columns[index + 1]?.key,
      toggle: (from, column) =>
        setColumns((was) => toggleColumn(was, from, column)),
    }
  }, [load, renew, clock, sessionStart, preset, columns])

  // --- Widths: dragged on a desktop, remembered per browser. --------------
  // Read on the first client render; the server renders one column, whose
  // width is 100% whatever was remembered, so nothing differs on hydration.
  const [widths, setWidths] = useState<SavedWidths>(() => {
    try {
      return typeof window === 'undefined'
        ? {}
        : readWidths(window.localStorage.getItem(WIDTHS_KEY))
    } catch {
      // Storage blocked: every column starts at its default width.
      return {}
    }
  })
  const resize = useCallback(
    (index: number, width: number, done: boolean) =>
      setWidths((was) => {
        const next =
          index === 0 ? { ...was, main: width } : { ...was, side: width }
        if (done) {
          try {
            window.localStorage.setItem(WIDTHS_KEY, JSON.stringify(next))
          } catch {
            // Not remembered, still applied.
          }
        }
        return next
      }),
    [],
  )

  const strip = useRef<HTMLDivElement | null>(null)
  const [stripWidth, setStripWidth] = useState(0)
  // A ref callback with a cleanup (React 19), so the observer lives exactly
  // as long as the element it watches.
  const measure = useCallback((element: HTMLDivElement | null) => {
    strip.current = element
    if (!element) return undefined
    const observer = new ResizeObserver(([entry]) =>
      setStripWidth(entry?.contentRect.width ?? 0),
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const sizes = columnWidths(columns.length, stripWidth, widths)

  const show = useCallback((index: number) => {
    strip.current?.children[index]?.scrollIntoView({
      behavior: reduceMotion() ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'start',
    })
  }, [])

  // A newly opened column slides into view; a closed one needs nothing.
  const opened = useRef(columns.length)
  useEffect(() => {
    const grew = columns.length > opened.current
    opened.current = columns.length
    if (grew) show(columns.length - 1)
  }, [columns.length, show])

  const close = useCallback(
    (index: number) => setColumns((was) => was.slice(0, index)),
    [],
  )

  if (state.status === 'loading') {
    return (
      <div
        role="status"
        aria-label="Loading the transcript"
        className="flex flex-col gap-3"
      >
        <div
          aria-hidden="true"
          className="bg-surface border-rule h-16 rounded-md border"
        />
        <div
          aria-hidden="true"
          className="bg-surface border-rule h-[60dvh] rounded-md border"
        />
      </div>
    )
  }
  if (state.status === 'missing' || (load && !main)) {
    return (
      <div className="border-rule rounded-md border border-dashed p-6">
        <h2 className="text-heading">No archived transcript</h2>
        <p className="text-text-secondary mt-2 max-w-prose text-body">
          A transcript can be viewed only once it has been archived. Archival is
          off until the person whose session this is turns it on for themselves;
          if this is your session, turning it on keeps your next sessions.
        </p>
        <a
          href={settingsHref}
          className="text-accent-text mt-3 inline-block text-body underline"
        >
          Transcript archival settings
        </a>
      </div>
    )
  }
  if (state.status === 'error' || !load || !main) {
    return (
      <div
        role="alert"
        className="border-bad-border bg-bad-bg flex flex-wrap items-center justify-between gap-3 rounded-md border p-4"
      >
        <p className="text-bad-text text-body">
          The transcript did not load.{' '}
          {state.status === 'error' ? state.message : ''}
        </p>
        <button
          type="button"
          onClick={reload}
          className="border-control-border h-(--control-h) rounded-md border px-3 text-caption"
        >
          Try again
        </button>
      </div>
    )
  }

  return (
    <ViewerContext.Provider value={viewer}>
      <div className="flex flex-col gap-3">
        <FilterBar
          preset={preset}
          onChange={setPreset}
          saved={saved}
          onSaved={setSaved}
          actions={actions}
          reload={reload}
        />

        {columns.length > 1 ? (
          <nav aria-label="Open columns" className="lg:hidden">
            <ol className="flex items-center gap-1 overflow-x-auto text-caption">
              {columns.map((column, index) => (
                <Crumb
                  key={column.key}
                  index={index}
                  title={titleOf(column)}
                  show={show}
                />
              ))}
            </ol>
          </nav>
        ) : null}

        <div
          ref={measure}
          // The frame's header, this page's own header and filters, and on a
          // phone the fixed bottom bar, are what the column height leaves
          // room for, so each column scrolls inside the viewport.
          className={`border-rule flex ${
            columns.length > 1
              ? 'h-[calc(100dvh-25rem)]'
              : 'h-[calc(100dvh-23rem)]'
          } min-h-[20rem] snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain lg:h-[calc(100dvh-15rem)] lg:snap-none lg:gap-0 lg:rounded-md lg:border`}
        >
          {columns.map((column, index) => (
            <ColumnFrame
              key={column.key}
              column={column}
              index={index}
              width={sizes[index] ?? null}
              fallbackWidth={stripWidth}
              single={columns.length === 1}
              resize={resize}
              close={close}
            >
              {column.kind === 'main' ? (
                <MainColumn
                  key={`${generation}:${main.id}`}
                  file={main}
                  preset={preset}
                  renew={renew}
                  signal={load.signal}
                  sessionId={sessionId}
                />
              ) : column.kind === 'agent' ? (
                <AgentColumn agentId={column.agentId} preset={preset} />
              ) : (
                <WorkflowColumn runId={column.runId} />
              )}
            </ColumnFrame>
          ))}
        </div>
      </div>
    </ViewerContext.Provider>
  )
}

function Crumb({
  index,
  title,
  show,
}: {
  index: number
  title: string
  show: (index: number) => void
}) {
  const go = useCallback(() => show(index), [show, index])
  return (
    <li className="flex shrink-0 items-center gap-1">
      {index > 0 ? (
        <span aria-hidden="true" className="text-text-muted">
          ›
        </span>
      ) : null}
      <button
        type="button"
        onClick={go}
        className="hover:bg-surface-hover max-w-[12rem] truncate rounded-md px-2 py-1"
      >
        {title}
      </button>
    </li>
  )
}

/**
 * One column's box: 84% wide on a phone, its computed width on a desktop,
 * with the drag handle on its right edge when there is more than one.
 */
function ColumnFrame({
  column,
  index,
  width,
  fallbackWidth,
  single,
  resize,
  close,
  children,
}: {
  column: Column
  index: number
  /** Null fills the row. */
  width: number | null
  fallbackWidth: number
  single: boolean
  resize: (index: number, width: number, done: boolean) => void
  close: (index: number) => void
  children: ReactNode
}) {
  const box = useRef<HTMLElement>(null)
  // A custom property rather than an inline width, so the phone layout's 84%
  // (a class) still wins below the lg breakpoint.
  useLayoutEffect(() => {
    box.current?.style.setProperty(
      '--col-w',
      width === null ? '100%' : `${width}px`,
    )
  }, [width])
  const context = useMemo(
    () => ({
      index,
      agentId: column.kind === 'agent' ? column.agentId : null,
    }),
    [index, column],
  )
  const onResize = useCallback(
    (next: number, done: boolean) => resize(index, next, done),
    [resize, index],
  )
  const onClose = useCallback(() => close(index), [close, index])
  const title = titleOf(column)

  return (
    <ColumnContext.Provider value={context}>
      <section
        ref={box}
        aria-label={title}
        className={`border-rule bg-ground relative flex h-full shrink-0 snap-start flex-col overflow-hidden rounded-md border lg:w-(--col-w) lg:rounded-none lg:border-0 lg:not-last:border-r ${
          single ? 'w-full' : 'w-[84%]'
        }`}
      >
        {column.kind === 'main' ? null : (
          <ColumnHeader
            title={title}
            detail={
              column.kind === 'agent'
                ? `Subagent · ${column.agentId}`
                : `Workflow · ${column.runId}`
            }
          >
            <button
              type="button"
              aria-label={`Close ${title}`}
              onClick={onClose}
              className="text-text-muted hover:bg-surface-hover hover:text-text grid size-8 shrink-0 place-items-center rounded-md"
            >
              ✕
            </button>
          </ColumnHeader>
        )}
        {children}
        {single ? null : (
          <DragHandle width={width ?? fallbackWidth} onResize={onResize} />
        )}
      </section>
    </ColumnContext.Provider>
  )
}

const dragged = (from: { x: number; width: number }, x: number) =>
  Math.max(MIN_WIDTH, Math.round(from.width + x - from.x))

/**
 * The right edge of a column, dragged to resize it on a desktop (never under
 * 440px), or focused and moved with the arrow keys. Pointer capture keeps the
 * drag on this element, so nothing is left listening on the window.
 */
function DragHandle({
  width,
  onResize,
}: {
  width: number
  onResize: (width: number, done: boolean) => void
}) {
  const drag = useRef<{ x: number; width: number } | null>(null)
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const step =
        event.key === 'ArrowRight' ? 24 : event.key === 'ArrowLeft' ? -24 : 0
      if (!step) return
      event.preventDefault()
      onResize(Math.max(MIN_WIDTH, Math.round(width) + step), true)
    },
    [onResize, width],
  )
  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId)
      drag.current = { x: event.clientX, width }
    },
    [width],
  )
  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (drag.current) onResize(dragged(drag.current, event.clientX), false)
    },
    [onResize],
  )
  const onPointerUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (drag.current) onResize(dragged(drag.current, event.clientX), true)
      drag.current = null
    },
    [onResize],
  )
  const onPointerCancel = useCallback(() => {
    drag.current = null
  }, [])

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize column"
      aria-valuemin={MIN_WIDTH}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      className="hover:bg-accent-border focus-visible:bg-accent-border absolute inset-y-0 right-0 hidden w-1.5 cursor-col-resize touch-none lg:block"
    />
  )
}
