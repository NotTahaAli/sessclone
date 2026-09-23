'use client'

import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from 'react'

import {
  summarizeRun,
  type Item,
  type Row,
  type RunSummary,
} from '@sessclone/shared'

import { compact, count, usd } from '../../../../../lib/money'
import { agentColumn, workflowColumn } from './columns'
import { ColumnContext, TaskStatusContext, useViewer } from './context'
import type { TurnCost } from './data'
import {
  duration,
  field,
  json,
  offset,
  sectionLabel,
  STATUS_LABEL,
  toolSummary,
} from './format'

// Tickets 102-105: one row of a column. Every row starts with its clock time;
// its details say how far into the Session it ran and, where there is one,
// how long it took. Anything the viewer does not recognise is a row of raw
// JSON rather than a broken page — the format is Claude Code's internal one.

type Of<K extends Item['kind']> = Extract<Item, { kind: K }>

/** Stable across chunk loads, so a prepended chunk does not remount the rest. */
export const rowKey = (row: Row, index: number) =>
  row.kind === 'item'
    ? row.item.id
    : row.kind === 'section'
      ? `section:${index}`
      : row.use.id

export function RowView({ row }: { row: Row }) {
  switch (row.kind) {
    case 'section':
      return <Rule>{sectionLabel(row.model, row.effort)}</Rule>
    case 'tool':
      return <ToolRow row={row} />
    case 'skill':
      return (
        <Shell at={row.use.at}>
          <Disclosure kind="Skill" name={row.skill}>
            <Meta at={row.use.at} />
            <Pre>
              {row.content?.text ||
                row.result?.text ||
                'The loaded skill text is not in this transcript.'}
            </Pre>
          </Disclosure>
        </Shell>
      )
    case 'agent':
      return (
        <Shell at={row.use.at}>
          <AgentBlock row={row} />
        </Shell>
      )
    case 'workflow':
      return (
        <Shell at={row.use.at}>
          <WorkflowBlock row={row} />
        </Shell>
      )
    case 'item':
      return <ItemRow item={row.item} />
    default:
      return null
  }
}

function ItemRow({ item }: { item: Item }) {
  switch (item.kind) {
    case 'user':
      return <UserRow item={item} />
    case 'assistant':
      return <AssistantRow item={item} />
    case 'thinking':
      return <ThinkingRow item={item} />
    case 'hook':
      return (
        <Shell at={item.at}>
          <Disclosure
            kind="Hook"
            text={`${item.event}${item.name ? ` · ${item.name}` : ''}${item.failed ? ' · failed' : ''}`}
            aside={item.durationMs === null ? '' : duration(item.durationMs)}
            bad={item.failed}
          >
            <HookDetail hook={item} />
          </Disclosure>
        </Shell>
      )
    case 'compaction':
      return (
        <Rule>
          Compacted{item.trigger ? ` (${item.trigger})` : ''}
          {item.preTokens === null
            ? ''
            : ` · ${compact.format(item.preTokens)} tokens before`}
        </Rule>
      )
    case 'interrupt':
      return (
        <Shell at={item.at}>
          <p className="text-warn-text text-caption">
            Interrupted{item.text ? ` · ${item.text}` : ''}
          </p>
        </Shell>
      )
    case 'api_error':
      return (
        <Shell at={item.at}>
          <p className="border-bad-border bg-bad-bg text-bad-text rounded-md border px-3 py-2 text-caption [overflow-wrap:anywhere]">
            API error · {item.text}
          </p>
        </Shell>
      )
    case 'slash_command':
      return (
        <Shell at={item.at}>
          <p className="font-mono text-caption [overflow-wrap:anywhere]">
            /{item.name.replace(/^\//, '')} {item.args}
          </p>
        </Shell>
      )
    case 'injected':
    case 'attachment':
    case 'queue':
    case 'tool_result':
      return (
        <Shell at={item.at}>
          <Disclosure
            kind={
              item.kind === 'injected'
                ? 'Injected'
                : item.kind === 'attachment'
                  ? item.attachmentType
                  : item.kind === 'queue'
                    ? `Queue · ${item.operation}`
                    : 'Tool result'
            }
            text={firstLine(item.text)}
          >
            <Meta at={item.at} />
            <Pre>{item.text || json(item.raw)}</Pre>
          </Disclosure>
        </Shell>
      )
    case 'unknown':
      return (
        <Shell at={item.at}>
          <Disclosure kind="Entry" name={item.type ?? 'unrecognised'}>
            <Meta at={item.at} />
            <Pre>{json(item.raw)}</Pre>
          </Disclosure>
        </Shell>
      )
    default:
      return null
  }
}

/** Past this, a message starts clamped: a pasted log should not fill a phone. */
const LONG = 700

function UserRow({ item }: { item: Of<'user'> }) {
  const long = item.text.length > LONG || item.text.split('\n', 13).length > 12
  const [open, setOpen] = useState(false)
  const flip = useCallback(() => setOpen((was) => !was), [])
  return (
    <Shell at={item.at}>
      <div className="border-rule bg-surface rounded-md border px-3 py-2">
        <p
          className={`text-body whitespace-pre-wrap [overflow-wrap:anywhere] ${long && !open ? 'line-clamp-8' : ''}`}
        >
          {item.text}
        </p>
        {long ? (
          <button
            type="button"
            onClick={flip}
            aria-expanded={open}
            className="text-accent-text mt-1 text-caption underline"
          >
            {open ? 'Show less' : 'Show all'}
          </button>
        ) : null}
      </div>
    </Shell>
  )
}

function AssistantRow({ item }: { item: Of<'assistant'> }) {
  const [open, setOpen] = useState(false)
  const flip = useCallback(() => setOpen((was) => !was), [])
  return (
    <Shell at={item.at}>
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-body whitespace-pre-wrap [overflow-wrap:anywhere]">
          {item.text}
        </p>
        <button
          type="button"
          onClick={flip}
          aria-expanded={open}
          aria-label="About this message"
          title="About this message"
          className="border-rule text-text-muted hover:text-text grid size-6 shrink-0 place-items-center rounded-full border font-serif text-caption italic"
        >
          i
        </button>
      </div>
      {open ? <Breakdown item={item} /> : null}
    </Shell>
  )
}

/** Ticket 104: what one model response was, and what it cost. */
function Breakdown({ item }: { item: Of<'assistant'> }) {
  const { costs, sessionStart, clock } = useViewer()
  const { agentId } = useContext(ColumnContext)
  const [cost, setCost] = useState<TurnCost | null | 'loading' | 'failed'>(
    item.messageId ? 'loading' : null,
  )

  useEffect(() => {
    const messageId = item.messageId
    if (!messageId) return undefined
    let live = true
    void (async () => {
      try {
        const all = await costs()
        if (live) setCost(all[`${agentId ?? ''}:${messageId}`] ?? null)
      } catch {
        if (live) setCost('failed')
      }
    })()
    return () => {
      live = false
    }
  }, [costs, agentId, item.messageId])

  const usage = item.usage
  const since = offset(item.at, sessionStart)
  const figures: [string, string][] = [
    ['Model', item.model ?? '—'],
    ['Effort', item.effort ?? '—'],
    ['Input', usage ? count.format(usage.inputTokens) : '—'],
    ['Output', usage ? count.format(usage.outputTokens) : '—'],
    ['Cache read', usage ? count.format(usage.cacheReadInputTokens) : '—'],
    ['Cache write', usage ? count.format(usage.cacheCreationInputTokens) : '—'],
    ['Stop reason', item.stopReason ?? '—'],
    [
      'Time',
      `${item.at ? clock.format(new Date(item.at)) : '—'}${since ? ` · ${since}` : ''}`,
    ],
    [
      'Cost',
      cost === 'loading'
        ? 'loading…'
        : cost === 'failed'
          ? 'did not load'
          : cost === null
            ? 'no priced Turn for this message'
            : cost.costUsd === null
              ? 'unpriced — no Rate for this model'
              : usd(cost.costUsd),
    ],
  ]
  return (
    <dl className="border-rule bg-surface mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md border p-3 text-caption">
      {figures.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-text-muted">{label}</dt>
          <dd className="font-mono [overflow-wrap:anywhere]">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function ThinkingRow({ item }: { item: Of<'thinking'> }) {
  const { thinking } = useViewer()
  const text = item.text.trim()

  if (!text) {
    // Claude Code often stores only the signature. The count, when the
    // line's usage reports one, says how much was hidden.
    const tokens = field(
      item.raw,
      'message',
      'usage',
      'output_tokens_details',
      'thinking_tokens',
    )
    return (
      <Shell at={item.at}>
        <p className="text-text-muted text-caption italic">
          thinking ·{' '}
          {typeof tokens === 'number' && tokens > 0
            ? `${count.format(tokens)} tokens, `
            : ''}
          text not stored
        </p>
      </Shell>
    )
  }
  return (
    <Shell at={item.at}>
      {thinking === 'verbose' ? (
        <p className="text-text-secondary border-rule border-l-2 pl-3 text-caption whitespace-pre-wrap italic [overflow-wrap:anywhere]">
          {text}
        </p>
      ) : (
        <Disclosure kind="Thinking">
          <p className="text-text-secondary text-caption whitespace-pre-wrap italic [overflow-wrap:anywhere]">
            {text}
          </p>
        </Disclosure>
      )}
    </Shell>
  )
}

function ToolRow({ row }: { row: Extract<Row, { kind: 'tool' }> }) {
  const { showToolOutput } = useViewer()
  const failed = row.result?.isError ?? false
  return (
    <Shell at={row.use.at}>
      <Disclosure
        name={row.use.name}
        text={toolSummary(row.use.name, row.use.input)}
        aside={`${failed ? 'error · ' : ''}${
          row.durationMs === null
            ? row.result
              ? ''
              : 'no result'
            : duration(row.durationMs)
        }`}
        bad={failed}
      >
        <Meta at={row.use.at} durationMs={row.durationMs} />
        <Pre label="Input">{json(row.use.input)}</Pre>
        {showToolOutput ? (
          <Pre label={failed ? 'Output (error)' : 'Output'}>
            {row.result ? row.result.text || '(empty)' : 'No result loaded.'}
          </Pre>
        ) : (
          <p className="text-text-muted text-caption">
            Output is hidden; turn on the Tool output filter to see it.
          </p>
        )}
        {row.hooks.map((hook) => (
          <div key={hook.id} className="border-rule border-l-2 pl-3">
            <p
              className={`text-caption ${hook.failed ? 'text-bad-text' : 'text-text-muted'}`}
            >
              Hook · {hook.event}
              {hook.name ? ` · ${hook.name}` : ''}
              {hook.failed ? ' · failed' : ''}
            </p>
            <HookDetail hook={hook} />
          </div>
        ))}
      </Disclosure>
    </Shell>
  )
}

function HookDetail({ hook }: { hook: Of<'hook'> }) {
  return (
    <>
      <Meta at={hook.at} durationMs={hook.durationMs} />
      {hook.command ? <Pre label="Command">{hook.command}</Pre> : null}
      {hook.exitCode === null ? null : (
        <p className="text-text-muted font-mono text-caption">
          exit {hook.exitCode}
        </p>
      )}
      {hook.output ? <Pre label="Output">{hook.output}</Pre> : null}
    </>
  )
}

const TONE = {
  done: 'border-ok-border bg-ok-bg text-ok-text',
  running: 'border-info-border bg-info-bg text-info-text',
  died_mid_turn: 'border-bad-border bg-bad-bg text-bad-text',
  not_stored: 'border-quiet-border bg-quiet-bg text-quiet-text',
  pending: 'border-quiet-border bg-quiet-bg text-quiet-text',
} as const

/** A status in words and colour both; the word carries it without the colour. */
export function Badge({
  tone,
  children,
}: {
  tone: keyof typeof TONE
  children: ReactNode
}) {
  return (
    <span
      className={`shrink-0 rounded-sm border px-1.5 py-px text-micro uppercase ${TONE[tone]}`}
    >
      {children}
    </span>
  )
}

/**
 * Runs `load` once the element scrolls into view, so a long column of
 * subagent blocks fetches only the transcripts somebody is looking at.
 */
const useWhenVisible = <T,>(
  load: (() => Promise<T | null> | null) | null,
): [React.RefObject<HTMLDivElement | null>, T | null] => {
  const ref = useRef<HTMLDivElement>(null)
  const [value, setValue] = useState<T | null>(null)
  useEffect(() => {
    const element = ref.current
    if (!element || !load) return undefined
    let live = true
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      void (async () => {
        try {
          const result = await load()
          if (live && result !== null) setValue(result)
        } catch {
          // The block says what it knows without it; opening the column
          // shows the failure.
        }
      })()
    })
    observer.observe(element)
    return () => {
      live = false
      observer.disconnect()
    }
  }, [load])
  return [ref, value]
}

function AgentBlock({ row }: { row: Extract<Row, { kind: 'agent' }> }) {
  const viewer = useViewer()
  const { index } = useContext(ColumnContext)
  const { agentId } = row
  const file = agentId ? viewer.transcriptFor(agentId) : undefined
  // A background launch answers at once, so its result says nothing about
  // whether the agent finished; the parent's task notification does.
  const statuses = useContext(TaskStatusContext)
  const returned =
    field(row.use.input, 'run_in_background') === true
      ? !!agentId && statuses.get(agentId) === 'completed'
      : !!row.result
  const title = row.description ?? row.agentType ?? 'Subagent'

  const [ref, run] = useWhenVisible<RunSummary>(
    useMemo(
      () =>
        agentId && file
          ? async () => {
              const items = await viewer.agentItems(agentId)
              return items ? summarizeRun(items, { returned }) : null
            }
          : null,
      [agentId, file, returned, viewer],
    ),
  )
  const toggle = useCallback(() => {
    if (agentId) viewer.toggle(index, agentColumn(agentId, title))
  }, [agentId, viewer, index, title])

  const status = !agentId
    ? row.result
      ? 'not_stored'
      : 'running'
    : !file
      ? 'not_stored'
      : (run?.status ?? 'pending')
  const open = !!agentId && viewer.openAfter(index) === `agent:${agentId}`

  return (
    <div
      ref={ref}
      className={`bg-surface rounded-md border ${open ? 'border-accent-border' : 'border-rule'}`}
    >
      <button
        type="button"
        disabled={!file}
        aria-expanded={open}
        onClick={toggle}
        className="enabled:hover:bg-surface-hover flex w-full flex-col items-start gap-1 rounded-md p-3 text-left disabled:cursor-default"
      >
        <span className="flex w-full items-baseline justify-between gap-2">
          <span className="text-text-secondary font-mono text-caption break-all">
            {row.agentType ?? 'Agent'}
          </span>
          <Badge tone={status}>
            {status === 'pending' ? '…' : STATUS_LABEL[status]}
          </Badge>
        </span>
        <span className="text-body [overflow-wrap:anywhere]">{title}</span>
        <span className="text-text-muted text-caption">
          {[
            run?.model ?? row.model,
            run?.durationMs == null ? null : duration(run.durationMs),
            run
              ? `${run.toolCount} ${run.toolCount === 1 ? 'tool' : 'tools'}`
              : null,
            file ? (open ? 'Close ‹' : 'Open ›') : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </button>
      {row.prompt ? (
        <div className="border-rule border-t px-3 py-2">
          <Disclosure kind="Prompt">
            <Pre>{row.prompt}</Pre>
          </Disclosure>
        </div>
      ) : null}
    </div>
  )
}

function WorkflowBlock({ row }: { row: Extract<Row, { kind: 'workflow' }> }) {
  const viewer = useViewer()
  const { index } = useContext(ColumnContext)
  const { runId } = row
  const file = runId ? viewer.journalFor(runId) : undefined
  const title = row.name ?? 'Workflow'
  const [ref, agents] = useWhenVisible(
    useMemo(
      () => (runId && file ? () => viewer.journal(runId) : null),
      [runId, file, viewer],
    ),
  )
  const toggle = useCallback(() => {
    if (runId) viewer.toggle(index, workflowColumn(runId, title))
  }, [runId, viewer, index, title])

  const status = !file
    ? 'not_stored'
    : !agents
      ? 'pending'
      : agents.every((agent) => agent.done) && row.result
        ? 'done'
        : 'running'
  const open = !!runId && viewer.openAfter(index) === `workflow:${runId}`

  return (
    <div
      ref={ref}
      className={`bg-surface rounded-md border ${open ? 'border-accent-border' : 'border-rule'}`}
    >
      <button
        type="button"
        disabled={!runId}
        aria-expanded={open}
        onClick={toggle}
        className="enabled:hover:bg-surface-hover flex w-full flex-col items-start gap-1 rounded-md p-3 text-left disabled:cursor-default"
      >
        <span className="flex w-full items-baseline justify-between gap-2">
          <span className="text-text-secondary font-mono text-caption">
            Workflow
          </span>
          <Badge tone={status}>
            {status === 'pending'
              ? '…'
              : status === 'not_stored'
                ? 'journal not stored'
                : STATUS_LABEL[status]}
          </Badge>
        </span>
        <span className="font-mono text-body break-all">{title}</span>
        {row.summary ? (
          <span className="text-text-secondary text-caption [overflow-wrap:anywhere]">
            {row.summary}
          </span>
        ) : null}
        <span className="text-text-muted text-caption">
          {[
            agents
              ? `${agents.length} ${agents.length === 1 ? 'agent' : 'agents'}`
              : null,
            runId ? (open ? 'Close ‹' : 'Open ›') : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </button>
    </div>
  )
}

function Shell({ at, children }: { at: string | null; children: ReactNode }) {
  const { clock } = useViewer()
  return (
    <li className="flex gap-3 px-3 py-2 [contain-intrinsic-size:auto_3rem] [content-visibility:auto]">
      <time
        dateTime={at ?? undefined}
        className="text-text-muted w-14 shrink-0 pt-0.5 font-mono text-micro tabular-nums"
      >
        {at ? clock.format(new Date(at)) : '—'}
      </time>
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </li>
  )
}

/** A rule across the column with a label: a model change, a compaction. */
function Rule({ children }: { children: ReactNode }) {
  return (
    <li className="text-text-muted flex items-center gap-3 px-3 py-2 font-mono text-micro">
      <span aria-hidden="true" className="bg-rule-strong h-px flex-1" />
      <span className="text-center">{children}</span>
      <span aria-hidden="true" className="bg-rule-strong h-px flex-1" />
    </li>
  )
}

/**
 * A details row whose body renders only once opened: a closed tool call
 * carries no JSON, so a column of hundreds of them stays cheap. Its summary
 * is a kind label, a monospace name, a line of text and a figure on the right,
 * any of them optional.
 */
function Disclosure({
  kind,
  name,
  text,
  aside,
  bad = false,
  children,
}: {
  kind?: string
  name?: string
  text?: string
  aside?: string
  bad?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const onToggle = useCallback(
    (event: SyntheticEvent<HTMLDetailsElement>) =>
      setOpen(event.currentTarget.open),
    [],
  )
  return (
    <details className="group" onToggle={onToggle}>
      <summary
        className={`hover:bg-surface-hover -mx-1 flex cursor-pointer list-none items-baseline gap-2 rounded-md px-1 [&::-webkit-details-marker]:hidden ${bad ? 'text-bad-text' : ''}`}
      >
        <span
          aria-hidden="true"
          className="text-text-muted inline-block w-2 shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none"
        >
          ›
        </span>
        {kind ? (
          <span className="text-text-muted shrink-0 text-micro uppercase">
            {kind}
          </span>
        ) : null}
        {name ? (
          <span className="shrink-0 font-mono text-caption font-medium break-all">
            {name}
          </span>
        ) : null}
        {text ? (
          <span
            className={`min-w-0 flex-1 truncate text-caption ${bad ? '' : 'text-text-secondary'}`}
          >
            {text}
          </span>
        ) : (
          <span className="flex-1" />
        )}
        {aside ? (
          <span className="text-text-muted shrink-0 font-mono text-micro">
            {aside}
          </span>
        ) : null}
      </summary>
      {open ? <div className="mt-2 flex flex-col gap-2">{children}</div> : null}
    </details>
  )
}

function Meta({
  at,
  durationMs,
}: {
  at: string | null
  durationMs?: number | null
}) {
  const { sessionStart } = useViewer()
  const since = offset(at, sessionStart)
  const parts = [
    since ? `${since} into the session` : null,
    durationMs == null ? null : `took ${duration(durationMs)}`,
  ].filter(Boolean)
  return parts.length ? (
    <p className="text-text-muted font-mono text-micro">{parts.join(' · ')}</p>
  ) : null
}

function Pre({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      {label ? (
        <p className="text-text-muted mb-1 text-micro uppercase">{label}</p>
      ) : null}
      <pre className="bg-ground border-rule max-h-96 overflow-auto rounded-md border p-2 text-caption whitespace-pre-wrap [overflow-wrap:anywhere]">
        {children}
      </pre>
    </div>
  )
}

const firstLine = (text: string) =>
  text.trim().split('\n', 1)[0]?.slice(0, 160) ?? ''
