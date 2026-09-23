'use client'

import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import {
  buildTimeline,
  parseLines,
  splitChunk,
  visibleRows,
  type Item,
  type JournalAgent,
  type Preset,
} from '@sessclone/shared'

import { NEAR_TOP, agentColumn, earlierRange, keepReading } from './columns'
import { ColumnContext, TaskStatusContext, useViewer } from './context'
import { concat, readBytes, type StoredFile } from './data'
import { Badge, RowView, rowKey } from './rows'
import { taskStatuses } from './tasks'

// Tickets 105 and 108: what goes inside one column. The Session's own column
// opens at the end and reads backwards a megabyte at a time as the reader
// scrolls up; a subagent's column is small enough to read whole and opens at
// its start.

/** Rows of loaded Items, filtered by the preset. Re-run over everything loaded. */
function Rows({ items, preset }: { items: Item[]; preset: Preset }) {
  const rows = useMemo(
    () => visibleRows(buildTimeline(items), preset).rows,
    [items, preset],
  )
  const statuses = useMemo(() => taskStatuses(items), [items])
  if (rows.length === 0) {
    return (
      <p className="text-text-muted p-4 text-caption">
        Nothing here under this filter.
      </p>
    )
  }
  return (
    <TaskStatusContext.Provider value={statuses}>
      <ol className="flex flex-col py-2">
        {rows.map((row, index) => (
          <RowView key={rowKey(row, index)} row={row} />
        ))}
      </ol>
    </TaskStatusContext.Provider>
  )
}

const EMPTY = new Uint8Array(0)

type Loaded = {
  items: Item[]
  /** First byte loaded; the file size before anything is. */
  from: number
  /** Bytes before the first newline of what is loaded, owed to the next chunk. */
  head: Uint8Array
}

export function MainColumn({
  file,
  preset,
  renew,
  signal,
  sessionId,
}: {
  file: StoredFile
  preset: Preset
  renew: (id: string) => Promise<StoredFile | null>
  signal: AbortSignal
  sessionId: string
}) {
  const [loaded, setLoaded] = useState<Loaded>({
    items: [],
    from: file.sizeBytes,
    head: EMPTY,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  // Refs rather than state for what the scroll handler reads, so a burst of
  // scroll events never starts two loads of the same range.
  const current = useRef(loaded)
  // The latest link for this file: a Reload of the list hands out new ones,
  // and that must not restart the column.
  const latest = useRef(file)
  useEffect(() => {
    latest.current = file
  }, [file])
  const loading = useRef(false)
  /** How the view should settle after the next commit. */
  const settle = useRef<{ fromBottom: number } | 'bottom' | 'top' | null>(
    'bottom',
  )

  const load = useCallback(
    async (toStart: boolean) => {
      const state = current.current
      const stored = latest.current
      const range = toStart
        ? state.from > 0
          ? { start: 0, end: state.from - 1 }
          : null
        : earlierRange(state.from)
      if (!range || loading.current) return
      loading.current = true
      setBusy(true)
      setError(null)
      try {
        const { bytes, whole } = await readBytes(
          stored,
          range,
          async () => {
            const fresh = await renew(stored.id)
            if (fresh) latest.current = fresh
            return fresh
          },
          signal,
        )
        const first = state.from === stored.sizeBytes
        const next: Loaded = whole
          ? {
              items: parseLines(
                splitChunk(bytes, 0, { atFileStart: true, atFileEnd: true })
                  .lines,
              ),
              from: 0,
              head: EMPTY,
            }
          : (() => {
              const split = splitChunk(concat(bytes, state.head), range.start, {
                atFileStart: range.start === 0,
                atFileEnd: first,
              })
              return {
                items: [...parseLines(split.lines), ...state.items],
                from: range.start,
                head: split.head,
              }
            })()
        const element = scroller.current
        settle.current = toStart
          ? 'top'
          : state.items.length === 0 || !element
            ? 'bottom'
            : { fromBottom: element.scrollHeight - element.scrollTop }
        current.current = next
        setLoaded(next)
      } catch (failure) {
        if (!signal.aborted) {
          setError(
            failure instanceof Error ? failure.message : 'It did not load.',
          )
        }
      } finally {
        loading.current = false
        if (!signal.aborted) setBusy(false)
      }
    },
    [renew, signal],
  )

  useEffect(() => {
    void load(false)
  }, [load])

  // Before paint, so a prepended chunk never flashes the view to the top.
  useLayoutEffect(() => {
    const element = scroller.current
    const target = settle.current
    if (!element) return
    if (target !== null && loaded.items.length > 0) {
      settle.current = null
      element.scrollTop =
        target === 'bottom'
          ? element.scrollHeight
          : target === 'top'
            ? 0
            : element.scrollHeight - target.fromBottom
    }
    // A chunk that parsed to nothing (a last line longer than a chunk), or a
    // filter leaving too few rows to scroll: keep reading until there is
    // something to scroll or nothing left.
    if (
      loaded.from < file.sizeBytes &&
      keepReading({
        from: loaded.from,
        items: loaded.items.length,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
      })
    ) {
      void load(false)
    }
  }, [loaded, load, file.sizeBytes])

  const onScroll = useCallback(() => {
    const element = scroller.current
    if (element && element.scrollTop < NEAR_TOP && current.current.from > 0) {
      void load(false)
    }
  }, [load])
  const earlier = useCallback(() => void load(false), [load])
  const toStart = useCallback(() => void load(true), [load])

  const more = loaded.from > 0
  return (
    <>
      <ColumnHeader title="Session" detail={sessionId}>
        {more ? (
          <button
            type="button"
            onClick={toStart}
            disabled={busy}
            className="border-control-border hover:bg-surface-hover shrink-0 rounded-md border px-2 py-1 text-caption whitespace-nowrap"
          >
            Jump to start
          </button>
        ) : null}
      </ColumnHeader>
      <div
        ref={scroller}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        {error ? (
          <Failure message={error} retry={earlier} />
        ) : more ? (
          <p className="text-text-muted p-3 text-center text-caption">
            {busy
              ? 'Loading earlier messages…'
              : 'Scroll up for earlier messages.'}
          </p>
        ) : null}
        {loaded.items.length === 0 && busy ? (
          <ColumnSkeleton />
        ) : loaded.items.length === 0 && !more && !error ? (
          <p className="text-text-muted p-4 text-caption">
            This transcript is empty.
          </p>
        ) : (
          <Rows items={loaded.items} preset={preset} />
        )}
      </div>
    </>
  )
}

/** A subagent's transcript, read whole and opened at its start. */
export function AgentColumn({
  agentId,
  preset,
}: {
  agentId: string
  preset: Preset
}) {
  const viewer = useViewer()
  const result = usePromise(
    useMemo(() => viewer.agentItems(agentId), [viewer, agentId]),
  )
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      {result.status === 'missing' ? (
        <p className="text-text-muted p-4 text-body">
          This subagent&apos;s transcript was not stored.
        </p>
      ) : result.status === 'pending' ? (
        <ColumnSkeleton />
      ) : result.status === 'failed' ? (
        <Failure message={result.message} retry={null} />
      ) : (
        <Rows items={result.value} preset={preset} />
      )}
    </div>
  )
}

/** Ticket 108: a workflow's agents, grouped by phase, from its journal. */
export function WorkflowColumn({ runId }: { runId: string }) {
  const viewer = useViewer()
  const result = usePromise(
    useMemo(() => viewer.journal(runId), [viewer, runId]),
  )

  const phases = useMemo(() => {
    const groups = new Map<string, JournalAgent[]>()
    if (result.status !== 'ready') return groups
    for (const agent of result.value) {
      const phase = agent.phase ?? 'No phase'
      let group = groups.get(phase)
      if (!group) groups.set(phase, (group = []))
      group.push(agent)
    }
    return groups
  }, [result])

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
      {result.status === 'missing' ? (
        <p className="text-text-muted text-body">
          This workflow&apos;s journal was not stored, so which agents belong to
          it is not known. Sessions archived before the Collector kept journals
          have none.
        </p>
      ) : result.status === 'pending' ? (
        <ColumnSkeleton />
      ) : result.status === 'failed' ? (
        <Failure message={result.message} retry={null} />
      ) : phases.size === 0 ? (
        <p className="text-text-muted text-body">
          The journal lists no agents.
        </p>
      ) : (
        [...phases].map(([phase, agents]) => (
          <section key={phase} className="mb-4">
            <h3 className="text-text-muted mb-2 text-label uppercase">
              {phase}
            </h3>
            <ul className="flex flex-col gap-2">
              {agents.map((agent) => (
                <WorkflowAgent key={agent.agentId} agent={agent} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}

function WorkflowAgent({ agent }: { agent: JournalAgent }) {
  const viewer = useViewer()
  const { index } = useContext(ColumnContext)
  const stored = !!viewer.transcriptFor(agent.agentId)
  const title = agent.label ?? agent.agentId
  const open = viewer.openAfter(index) === `agent:${agent.agentId}`
  const toggle = useCallback(
    () => viewer.toggle(index, agentColumn(agent.agentId, title)),
    [viewer, index, agent.agentId, title],
  )
  const state = !stored ? 'not_stored' : agent.done ? 'done' : 'running'
  return (
    <li>
      <button
        type="button"
        disabled={!stored}
        aria-expanded={open}
        onClick={toggle}
        className={`bg-surface enabled:hover:bg-surface-hover flex w-full items-baseline justify-between gap-2 rounded-md border p-3 text-left ${open ? 'border-accent-border' : 'border-rule'}`}
      >
        <span className="min-w-0">
          <span className="block text-body break-all">{title}</span>
          <span className="text-text-muted block font-mono text-micro break-all">
            {agent.agentId}
            {stored ? (open ? ' · Close ‹' : ' · Open ›') : ''}
          </span>
        </span>
        <Badge tone={state}>
          {state === 'not_stored' ? 'not stored' : state}
        </Badge>
      </button>
    </li>
  )
}

type Settled<T> =
  | { status: 'missing' }
  | { status: 'pending' }
  | { status: 'failed'; message: string }
  | { status: 'ready'; value: T }

/** A cached promise's state; null means there is no file to read. */
function usePromise<T>(promise: Promise<T> | null): Settled<T> {
  const [state, setState] = useState<{
    promise: Promise<T> | null
    settled: Settled<T>
  }>({ promise: null, settled: { status: 'pending' } })

  useEffect(() => {
    if (!promise) return undefined
    let live = true
    void (async () => {
      let settled: Settled<T>
      try {
        settled = { status: 'ready', value: await promise }
      } catch (failure) {
        settled = {
          status: 'failed',
          message:
            failure instanceof Error ? failure.message : 'It did not load.',
        }
      }
      if (live) setState({ promise, settled })
    })()
    return () => {
      live = false
    }
  }, [promise])

  if (!promise) return { status: 'missing' }
  return state.promise === promise ? state.settled : { status: 'pending' }
}

function ColumnSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-3 p-3">
      {['h-16', 'h-10', 'h-24', 'h-12', 'h-14'].map((height) => (
        <div
          key={height}
          aria-hidden="true"
          className={`bg-surface border-rule rounded-md border ${height}`}
        />
      ))}
    </div>
  )
}

function Failure({
  message,
  retry,
}: {
  message: string
  retry: (() => void) | null
}) {
  return (
    <div
      role="alert"
      className="border-bad-border bg-bad-bg m-3 flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
    >
      <p className="text-bad-text text-caption">
        This transcript did not load. {message}
      </p>
      {retry ? (
        <button
          type="button"
          onClick={retry}
          className="border-control-border rounded-md border px-3 py-1 text-caption"
        >
          Try again
        </button>
      ) : null}
    </div>
  )
}

/** A column's title bar: what it is, its id, and its one or two controls. */
export function ColumnHeader({
  title,
  detail,
  children,
}: {
  title: string
  detail: string
  children?: ReactNode
}) {
  return (
    <header className="border-rule bg-surface flex min-h-12 items-center justify-between gap-2 border-b px-3 py-2">
      <div className="min-w-0">
        <h2 className="text-heading truncate">{title}</h2>
        <p className="text-text-muted truncate font-mono text-micro">
          {detail}
        </p>
      </div>
      {children}
    </header>
  )
}
