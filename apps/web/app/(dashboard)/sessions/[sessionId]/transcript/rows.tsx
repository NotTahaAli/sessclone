'use client'

import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
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
import { artifactInfo, sealed, writtenBefore } from './artifacts'
import {
  ColumnContext,
  ItemsContext,
  TaskStatusContext,
  useViewer,
} from './context'
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
import { parseEnvelope } from './envelope'
import { MarkdownText } from './markdown'
import { Sheet, useLongPress } from './sheet'
import { isArtifact, stepsLabel, type Display, type StepGroup } from './steps'

// Tickets 105-108: one row of a column, drawn as a chat (Taha, 2026-09-23):
// your messages in a bubble on the right, Claude's as plain markdown, and the
// work between them folded into one line. Times show on hover or a tap; a
// row's details say how far into the Session it ran and how long it took. Anything the viewer does not recognise is a row of raw
// JSON rather than a broken page — the format is Claude Code's internal one.

type Of<K extends Item['kind']> = Extract<Item, { kind: K }>

/** Stable across chunk loads, so a prepended chunk does not remount the rest. */
export const rowKey = (row: Display, index: number): string =>
  row.kind === 'item'
    ? row.item.id
    : row.kind === 'section'
      ? `section:${index}`
      : row.kind === 'steps'
        ? `steps:${rowKey(row.rows[0]!, index)}`
        : row.use.id

export function RowView({ row }: { row: Display }) {
  switch (row.kind) {
    case 'steps':
      return <StepsRow group={row} />
    case 'section':
      return <Rule>{sectionLabel(row.model, row.effort)}</Rule>
    case 'tool':
      return isArtifact(row) ? (
        <ArtifactCard row={row} />
      ) : (
        <ToolRow row={row} />
      )
    case 'skill':
      return (
        <Shell>
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
        <Shell>
          <AgentBlock row={row} />
        </Shell>
      )
    case 'workflow':
      return (
        <Shell>
          <WorkflowBlock row={row} />
        </Shell>
      )
    case 'item':
      return <ItemRow item={row.item} />
    default:
      return null
  }
}

/**
 * Consecutive thinking, tool calls and hooks between two messages, folded into
 * one line. Its time runs from the first step's start to the last one's end.
 */
function StepsRow({ group }: { group: StepGroup }) {
  const [open, setOpen] = useState(false)
  const flip = useCallback(() => setOpen((was) => !was), [])
  const failed = group.rows.some(
    (row) =>
      (row.kind === 'tool' && row.result?.isError) ||
      (row.kind === 'item' && row.item.kind === 'hook' && row.item.failed),
  )
  const took =
    group.startAt && group.endAt
      ? Date.parse(group.endAt) - Date.parse(group.startAt)
      : Number.NaN
  return (
    <Shell>
      <button
        type="button"
        onClick={flip}
        aria-expanded={open}
        className="group/steps text-text-muted hover:text-text flex w-full items-baseline gap-2 text-left text-caption"
      >
        <span
          aria-hidden="true"
          className={`inline-block w-2 shrink-0 transition-transform motion-reduce:transition-none ${open ? 'rotate-90' : ''}`}
        >
          ›
        </span>
        <span className={failed ? 'text-bad-text' : ''}>
          {stepsLabel(group.rows)}
          {failed ? ' · an error' : ''}
        </span>
        <Hover at={group.startAt} className="ml-auto" />
        {Number.isNaN(took) ? null : (
          <span className="font-mono text-micro">{duration(took)}</span>
        )}
      </button>
      {open ? (
        <ol className="border-rule mt-1 ml-1 flex flex-col border-l-2">
          {group.rows.map((row, index) => (
            <RowView key={rowKey(row, index)} row={row} />
          ))}
        </ol>
      ) : null}
    </Shell>
  )
}

/** A clock time that shows on hover, focus or a tap of its row. */
function Hover({
  at,
  className = '',
}: {
  at: string | null
  className?: string
}) {
  const { clock } = useViewer()
  if (!at) return null
  return (
    <time
      dateTime={at}
      className={`text-text-muted font-mono text-micro tabular-nums opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 group-data-[shown]/row:opacity-100 motion-reduce:transition-none ${className}`}
    >
      {clock.format(new Date(at))}
    </time>
  )
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
        <Shell>
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
        <Shell>
          <p className="text-warn-text text-caption">
            Interrupted{item.text ? ` · ${item.text}` : ''}
          </p>
        </Shell>
      )
    case 'api_error':
      return (
        <Shell>
          <p className="border-bad-border bg-bad-bg text-bad-text rounded-md border px-3 py-2 text-caption [overflow-wrap:anywhere]">
            API error · {item.text}
          </p>
        </Shell>
      )
    case 'slash_command':
      return (
        <Shell>
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
        <Shell>
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
        <Shell>
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

const isLong = (text: string) =>
  text.length > LONG || text.split('\n', 13).length > 12

/**
 * A message, yours or Claude's. Its time and actions show on hover or focus,
 * and on a phone after a tap; press and hold opens Copy and Select text.
 * Until Select text is chosen a phone does not select on a hold, so the two
 * menus never both appear.
 */
function Message({
  at,
  copyText,
  mine,
  author,
  info,
  raw,
  children,
}: {
  at: string | null
  /** The message as it was written, markdown and all. */
  copyText: string
  mine: boolean
  /** Who wrote it, above the bubble, when that is worth saying. */
  author?: string | null
  /** Claude's messages only: what the "i" button's popup describes. */
  info?: Of<'assistant'>
  /** The message exactly as Claude received it, when it arrived wrapped. */
  raw?: string
  children: ReactNode
}) {
  const [shown, setShown] = useState(false)
  const [menu, setMenu] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [rawOpen, setRawOpen] = useState(false)
  const openRaw = useCallback(() => setRawOpen(true), [])
  const closeRaw = useCallback(() => setRawOpen(false), [])
  const [selectable, setSelectable] = useState(false)
  const [copied, setCopied] = useState(false)
  const body = useRef<HTMLDivElement>(null)

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(copyText)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }, [copyText])
  const hold = useLongPress(useCallback(() => setMenu(true), []))
  const onClick = useCallback((event: MouseEvent) => {
    // A tap, not a click on a link or button inside the message.
    if (event.target instanceof Element && event.target.closest('a, button'))
      return
    setShown((was) => !was)
  }, [])
  const closeMenu = useCallback(() => setMenu(false), [])
  const menuCopy = useCallback(() => {
    setMenu(false)
    void copy()
  }, [copy])
  const menuSelect = useCallback(() => {
    setMenu(false)
    setSelectable(true)
    // After the class change lands, so the selection is not refused.
    requestAnimationFrame(() => {
      // The words only, not the chips and buttons around them.
      const element = body.current?.querySelector('[data-text]') ?? body.current
      const selection = window.getSelection()
      if (element && selection) selection.selectAllChildren(element)
    })
  }, [])
  const openInfo = useCallback(() => setInfoOpen(true), [])
  const closeInfo = useCallback(() => setInfoOpen(false), [])
  const menuInfo = useCallback(() => {
    setMenu(false)
    setInfoOpen(true)
  }, [])

  return (
    <li
      data-shown={shown ? '' : undefined}
      className={`group/row flex flex-col gap-1 px-4 py-2 [contain-intrinsic-size:auto_3rem] [content-visibility:auto] ${mine ? 'items-end' : 'items-stretch'}`}
    >
      {author ? (
        <span className="text-text-muted px-1 text-micro">{author}</span>
      ) : null}
      <div
        ref={body}
        onClick={onClick}
        {...hold}
        className={`${selectable ? '' : 'pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none]'} ${
          mine
            ? 'bg-surface-hover max-w-[85%] rounded-2xl px-3.5 py-2'
            : 'min-w-0'
        }`}
      >
        {children}
      </div>
      <div
        className={`flex items-center gap-1 ${mine ? 'flex-row-reverse' : ''}`}
      >
        <Hover at={at} className="px-1" />
        <Action label={copied ? 'Copied' : 'Copy'} onClick={copy}>
          {copied ? '✓' : '⧉'}
        </Action>
        {raw ? (
          <Action label="As Claude received it" onClick={openRaw}>
            <span className="font-mono text-micro">{'</>'}</span>
          </Action>
        ) : null}
        {info ? (
          <Action label="About this message" onClick={openInfo}>
            <span className="font-serif italic">i</span>
          </Action>
        ) : null}
      </div>
      <Sheet open={menu} onClose={closeMenu} title="Message">
        <div className="flex flex-col">
          <MenuItem onClick={menuCopy}>Copy</MenuItem>
          <MenuItem onClick={menuSelect}>Select text</MenuItem>
          {info ? (
            <MenuItem onClick={menuInfo}>About this message</MenuItem>
          ) : null}
        </div>
      </Sheet>
      {raw ? (
        <Sheet open={rawOpen} onClose={closeRaw} title="As Claude received it">
          <Pre>{raw}</Pre>
        </Sheet>
      ) : null}
      {info ? (
        <Sheet open={infoOpen} onClose={closeInfo} title="About this message">
          {infoOpen ? <Breakdown item={info} /> : null}
        </Sheet>
      ) : null}
    </li>
  )
}

/** A small action under a message, shown on hover, focus or a tap. */
function Action({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="text-text-muted hover:bg-surface-hover hover:text-text grid size-7 place-items-center rounded-md text-caption opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 group-data-[shown]/row:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none"
    >
      {children}
    </button>
  )
}

function MenuItem({
  onClick,
  children,
}: {
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="hover:bg-surface-hover rounded-md px-3 py-3 text-left text-body"
    >
      {children}
    </button>
  )
}

function UserRow({ item }: { item: Of<'user'> }) {
  const envelope = useMemo(() => parseEnvelope(item.text), [item.text])
  const [open, setOpen] = useState(false)
  const flip = useCallback(() => setOpen((was) => !was), [])

  if (envelope?.kind === 'context') {
    return (
      <Shell>
        <Disclosure kind="Session context">
          <Pre>{item.text}</Pre>
        </Disclosure>
      </Shell>
    )
  }
  const text = envelope ? envelope.body : item.text
  const long = isLong(text)
  const attached = envelope
    ? [
        ...envelope.files,
        ...(envelope.files.length === 0 && envelope.images
          ? Array.from({ length: envelope.images }, () => 'image')
          : []),
      ]
    : []
  return (
    <Message
      at={item.at}
      copyText={text}
      mine
      author={envelope?.author}
      raw={envelope ? item.text : undefined}
    >
      {attached.length ? (
        <span className="mb-1 flex flex-wrap justify-end gap-1">
          {attached.map((name, index) => (
            <span
              // Two attachments can share a name; order alone tells them apart.
              // oxlint-disable-next-line react/no-array-index-key
              key={`${name}:${index}`}
              title="Attached; the file itself is not in the transcript"
              className="border-rule bg-ground text-text-secondary rounded-md border px-2 py-0.5 text-micro"
            >
              {name}
            </span>
          ))}
        </span>
      ) : null}
      <p
        data-text
        className={`text-body whitespace-pre-wrap [overflow-wrap:anywhere] ${long && !open ? 'line-clamp-8' : ''}`}
      >
        {text}
      </p>
      {long ? (
        <button
          type="button"
          onClick={flip}
          aria-expanded={open}
          className="text-accent-text mt-1 block text-caption underline"
        >
          {open ? 'Show less' : 'Show all'}
        </button>
      ) : null}
    </Message>
  )
}

function AssistantRow({ item }: { item: Of<'assistant'> }) {
  return (
    <Message at={item.at} copyText={item.text} mine={false} info={item}>
      <MarkdownText text={item.text} />
    </Message>
  )
}

/** Ticket 107: what one model response was, and what it cost. */
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
      <Shell>
        <p className="text-text-muted text-caption italic">
          Thought ·{' '}
          {typeof tokens === 'number' && tokens > 0
            ? `${count.format(tokens)} tokens, `
            : ''}
          text not stored
        </p>
      </Shell>
    )
  }
  return (
    <Shell>
      {thinking === 'verbose' ? (
        <p className="text-text-secondary border-rule border-l-2 pl-3 text-caption whitespace-pre-wrap italic [overflow-wrap:anywhere]">
          {text}
        </p>
      ) : (
        <Disclosure kind="Thought">
          <p className="text-text-secondary text-caption whitespace-pre-wrap italic [overflow-wrap:anywhere]">
            {text}
          </p>
        </Disclosure>
      )}
    </Shell>
  )
}

/**
 * An artifact publish: its card, its link, and a preview of the HTML the
 * transcript wrote for it. The preview runs in a sandboxed frame with no
 * same-origin access, so the page cannot read the dashboard, its cookies or
 * its storage.
 */
function ArtifactCard({ row }: { row: Extract<Row, { kind: 'tool' }> }) {
  const info = useMemo(() => artifactInfo(row), [row])
  const items = useContext(ItemsContext)
  const [open, setOpen] = useState(false)
  const flip = useCallback(() => setOpen((was) => !was), [])
  const written = useMemo(
    () => (open ? writtenBefore(items, info.path, row.use.offset) : null),
    [open, items, info.path, row.use.offset],
  )
  const name = info.path.split('/').pop() ?? info.path
  return (
    <Shell>
      <div className="border-rule bg-surface flex flex-col overflow-hidden rounded-xl border">
        <div className="flex items-start gap-3 p-3">
          <span
            aria-hidden="true"
            className="border-rule bg-ground text-text-muted grid size-9 shrink-0 place-items-center rounded-md border font-mono text-micro"
          >
            {'</>'}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-body font-medium [overflow-wrap:anywhere]">
              {info.title ?? name}
            </span>
            <span className="text-text-muted block text-caption [overflow-wrap:anywhere]">
              {info.description ?? `Artifact · ${name}`}
            </span>
          </span>
          {info.url && info.url.startsWith('https://') ? (
            <a
              href={info.url}
              target="_blank"
              rel="noopener noreferrer"
              className="border-control-border hover:bg-surface-hover shrink-0 rounded-md border px-2.5 py-1 text-caption"
            >
              Open ↗
            </a>
          ) : null}
        </div>
        <button
          type="button"
          onClick={flip}
          aria-expanded={open}
          className="border-rule text-text-secondary hover:bg-surface-hover border-t px-3 py-2 text-left text-caption"
        >
          {open ? 'Hide preview' : 'Show preview'}
        </button>
        {written?.status === 'found' ? (
          <>
            {written.stale ? (
              <p className="text-warn-text border-rule border-t px-3 py-1.5 text-caption">
                The file was edited after this; the preview is the version first
                written.
              </p>
            ) : null}
            <iframe
              title={`Preview of ${info.title ?? name}`}
              sandbox="allow-scripts"
              srcDoc={sealed(written.html)}
              loading="lazy"
              className="border-rule h-[28rem] w-full border-t bg-white"
            />
          </>
        ) : written ? (
          <p className="text-text-muted border-rule border-t px-3 py-2 text-caption">
            The page&apos;s HTML is not in the loaded part of this transcript,
            so there is no preview.{' '}
            {info.url ? 'Open shows the published page.' : ''}
          </p>
        ) : null}
      </div>
    </Shell>
  )
}

function ToolRow({ row }: { row: Extract<Row, { kind: 'tool' }> }) {
  const { showToolOutput } = useViewer()
  const failed = row.result?.isError ?? false
  return (
    <Shell>
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

function Shell({ children }: { children: ReactNode }) {
  return (
    <li className="group/row flex min-w-0 flex-col px-4 py-1 [contain-intrinsic-size:auto_2rem] [content-visibility:auto]">
      {children}
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
