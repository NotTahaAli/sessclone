'use client'

import {
  useCallback,
  useId,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
  type FormEvent,
  type ToggleEvent,
} from 'react'

import {
  ALL,
  CATEGORIES,
  NORMAL,
  type Category,
  type Preset,
  type ThinkingMode,
} from '@sessclone/shared'

import { ChevronDownIcon } from './icons'
import type { SavedPreset } from '../../../../../lib/view-presets'

// Ticket 106: which rows a column shows. A preset is a set of chips plus a
// thinking mode. Normal and All are built in and cannot be changed; anything
// else is the reader's own, saved to their account so it follows them.

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

/** The preset Server Actions, passed in so a harness can stand in for them. */
export type PresetActions = {
  save: (input: {
    name: string
    categories: Category[]
    thinking: ThinkingMode
  }) => Promise<Result<SavedPreset>>
  remove: (id: string) => Promise<Result<null>>
  setDefault: (id: string | null) => Promise<Result<null>>
}

export const CATEGORY_LABEL: Record<Category, string> = {
  user: 'Your messages',
  assistant: 'Model messages',
  tool: 'Tool calls',
  tool_output: 'Tool output',
  skill: 'Skills',
  agent: 'Subagents',
  workflow: 'Workflows',
  hook: 'Every hook',
  hook_failed: 'Failed hooks',
  section: 'Model changes',
  compaction: 'Compaction',
  interrupt: 'Interrupts',
  api_error: 'API errors',
  slash_command: 'Slash commands',
  injected: 'Reminders',
  attachment: 'Attachments',
  queue: 'Queue',
  unknown: 'Everything else',
}

const THINKING: readonly ThinkingMode[] = ['hidden', 'collapsed', 'verbose']
const THINKING_LABEL: Record<ThinkingMode, string> = {
  hidden: 'Hidden',
  collapsed: 'Collapsed',
  verbose: 'Verbose',
}

const same = (a: Preset, b: Preset) =>
  a.thinking === b.thinking &&
  a.categories.length === b.categories.length &&
  a.categories.every((category) => b.categories.includes(category))

/** Which named preset the current filter is, or `custom`. */
export const presetId = (preset: Preset, saved: SavedPreset[]) =>
  same(preset, NORMAL)
    ? 'normal'
    : same(preset, ALL)
      ? 'all'
      : (saved.find((one) => same(preset, one))?.id ?? 'custom')

const EMPTY: SavedPreset[] = []

const control =
  'border-control-border bg-surface text-text h-(--control-h) rounded-md border px-2 text-body'
const button =
  'border-control-border text-text hover:bg-surface-hover h-(--control-h) rounded-md border px-3 text-caption whitespace-nowrap disabled:opacity-60'

export function FilterBar({
  preset,
  onChange,
  saved,
  onSaved,
  actions,
}: {
  preset: Preset
  onChange: (preset: Preset) => void
  /** The reader's presets; null when they could not be read. */
  saved: SavedPreset[] | null
  onSaved: (saved: SavedPreset[]) => void
  actions: PresetActions | null
}) {
  const [naming, setNaming] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const list = saved ?? EMPTY
  const selected = presetId(preset, list)
  const own = list.find((one) => one.id === selected) ?? null
  const isDefault = own
    ? own.isDefault
    : selected === 'normal' && !list.some((one) => one.isDefault)

  const toggle = useCallback(
    (category: Category) =>
      onChange({
        ...preset,
        categories: preset.categories.includes(category)
          ? preset.categories.filter((one) => one !== category)
          : [...preset.categories, category],
      }),
    [preset, onChange],
  )

  const run = useCallback(
    <T,>(call: () => Promise<Result<T>>, done: (value: T) => void) =>
      start(async () => {
        setMessage(null)
        let result: Result<T>
        try {
          result = await call()
        } catch {
          result = { ok: false, error: 'That did not reach the server.' }
        }
        if (result.ok) done(result.value)
        else setMessage(result.error)
      }),
    [],
  )

  const save = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const name = new FormData(event.currentTarget).get('name')
      if (!actions || typeof name !== 'string' || !name.trim()) return
      run(
        () => actions.save({ name: name.trim(), ...preset }),
        (value) => {
          onSaved([...list.filter((one) => one.name !== value.name), value])
          setNaming(false)
        },
      )
    },
    [actions, run, preset, list, onSaved],
  )

  const makeDefault = useCallback(() => {
    if (!actions) return
    run(
      () => actions.setDefault(own ? own.id : null),
      () =>
        onSaved(
          list.map((one) => ({
            ...one,
            isDefault: own ? one.id === own.id : false,
          })),
        ),
    )
  }, [actions, run, own, list, onSaved])

  const remove = useCallback(() => {
    if (!actions || !own) return
    run(
      () => actions.remove(own.id),
      () => onSaved(list.filter((one) => one.id !== own.id)),
    )
  }, [actions, run, own, list, onSaved])

  const startNaming = useCallback(() => setNaming(true), [])
  const stopNaming = useCallback(() => setNaming(false), [])

  return (
    <div className="flex flex-col gap-3">
      <p className="text-text-muted text-caption">
        {preset.categories.length} of {CATEGORIES.length} row types on
      </p>
      <div className="flex flex-col gap-3">
        <ul className="flex flex-wrap gap-2" aria-label="Row types">
          {CATEGORIES.map((category) => (
            <Chip
              key={category}
              category={category}
              on={preset.categories.includes(category)}
              toggle={toggle}
            />
          ))}
        </ul>

        {actions && saved ? (
          <div className="flex flex-wrap items-center gap-2">
            {naming ? (
              <form
                onSubmit={save}
                className="flex flex-wrap items-center gap-2"
              >
                <label className="sr-only" htmlFor="preset-name">
                  Name for this preset
                </label>
                <input
                  id="preset-name"
                  name="name"
                  autoFocus
                  required
                  maxLength={60}
                  placeholder="Preset name"
                  className={`${control} text-base`}
                />
                <button type="submit" disabled={pending} className={button}>
                  {pending ? 'Saving…' : 'Save'}
                </button>
                <button type="button" onClick={stopNaming} className={button}>
                  Cancel
                </button>
              </form>
            ) : (
              <button type="button" onClick={startNaming} className={button}>
                Save as preset
              </button>
            )}
            {selected !== 'custom' && selected !== 'all' ? (
              <button
                type="button"
                disabled={pending || isDefault}
                onClick={makeDefault}
                className={button}
              >
                {isDefault ? 'Your default' : 'Make default'}
              </button>
            ) : null}
            {own ? (
              <button
                type="button"
                disabled={pending}
                onClick={remove}
                className={`${button} border-bad-border text-bad-text`}
              >
                Delete “{own.name}”
              </button>
            ) : null}
          </div>
        ) : (
          <p className="text-text-muted text-caption">
            Your saved presets did not load; Normal and All still work.
          </p>
        )}
        {message ? (
          <p role="alert" className="text-bad-text text-caption">
            {message}
          </p>
        ) : null}
      </div>
    </div>
  )
}

function Chip({
  category,
  on,
  toggle,
}: {
  category: Category
  on: boolean
  toggle: (category: Category) => void
}) {
  const press = useCallback(() => toggle(category), [toggle, category])
  return (
    <li>
      <button
        type="button"
        aria-pressed={on}
        onClick={press}
        className={`rounded-md border px-2.5 py-1 text-caption ${
          on
            ? 'border-accent-border bg-accent-subtle text-text'
            : 'border-rule text-text-muted hover:bg-surface-hover'
        }`}
      >
        <span aria-hidden="true">{on ? '✓ ' : ''}</span>
        {CATEGORY_LABEL[category]}
      </button>
    </li>
  )
}

/**
 * The header's one view control (Taha, 2026-09-23), shaped like the model
 * picker in Claude's apps: a pill naming the preset and thinking mode, opening
 * a menu of both, with the finer filters one step further in. A native
 * popover, so the browser gives it the top layer, Escape and click-away.
 */
export function ViewMenu({
  preset,
  onChange,
  saved,
  openFilters,
}: {
  preset: Preset
  onChange: (preset: Preset) => void
  saved: SavedPreset[] | null
  openFilters: () => void
}) {
  const id = useId()
  const menu = useRef<HTMLDivElement>(null)
  const pill = useRef<HTMLButtonElement>(null)
  const [place, setPlace] = useState<CSSProperties>({})
  const list = saved ?? EMPTY
  const selected = presetId(preset, list)
  const name =
    selected === 'normal'
      ? 'Normal'
      : selected === 'all'
        ? 'All'
        : (list.find((one) => one.id === selected)?.name ?? 'Custom')

  // The top layer ignores the pill's position, so the menu is placed under
  // it each time it opens, right edges aligned, before its first paint.
  // ponytail: not re-placed on a resize while open; close and reopen fixes it.
  const onToggle = useCallback((event: ToggleEvent<HTMLDivElement>) => {
    const box = pill.current?.getBoundingClientRect()
    if (event.newState === 'open' && box) {
      setPlace({
        top: box.bottom + 6,
        right: Math.max(8, document.documentElement.clientWidth - box.right),
      })
    }
  }, [])
  const close = useCallback(() => menu.current?.hidePopover(), [])
  const filters = useCallback(() => {
    close()
    openFilters()
  }, [close, openFilters])

  return (
    <>
      <button
        ref={pill}
        type="button"
        popoverTarget={id}
        className="border-rule text-text hover:bg-surface-hover flex h-9 min-w-0 shrink items-center gap-1.5 rounded-full border px-3 text-caption"
      >
        <span className="truncate">{name}</span>
        <span className="text-text-muted truncate">
          · <span className="max-sm:hidden">Thinking </span>
          {THINKING_LABEL[preset.thinking].toLowerCase()}
        </span>
        <ChevronDownIcon />
      </button>
      <div
        ref={menu}
        id={id}
        popover="auto"
        onBeforeToggle={onToggle}
        aria-label="View options"
        style={place}
        className="border-rule bg-ground text-text fixed inset-auto m-0 w-64 rounded-xl border p-1 shadow-lg"
      >
        <MenuHeading>View</MenuHeading>
        <MenuOption
          on={selected === 'normal'}
          pick={onChange}
          categories={NORMAL.categories}
          thinking={NORMAL.thinking}
          label="Normal"
          close={close}
        />
        <MenuOption
          on={selected === 'all'}
          pick={onChange}
          categories={ALL.categories}
          thinking={ALL.thinking}
          label="All"
          close={close}
        />
        {list.map((one) => (
          <MenuOption
            key={one.id}
            on={selected === one.id}
            pick={onChange}
            categories={one.categories}
            thinking={one.thinking}
            label={one.isDefault ? `${one.name} (default)` : one.name}
            close={close}
          />
        ))}
        {selected === 'custom' ? (
          <p className="flex items-center gap-2 px-2 py-1.5 text-caption">
            <Tick on />
            Custom
          </p>
        ) : null}
        <hr className="border-rule my-1" />
        <MenuHeading>Thinking</MenuHeading>
        {THINKING.map((mode) => (
          <MenuOption
            key={mode}
            on={preset.thinking === mode}
            pick={onChange}
            categories={preset.categories}
            thinking={mode}
            label={THINKING_LABEL[mode]}
            close={close}
          />
        ))}
        <hr className="border-rule my-1" />
        <button
          type="button"
          onClick={filters}
          className="hover:bg-surface-hover flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-caption"
        >
          <span className="w-4" />
          Filters and presets…
        </button>
      </div>
    </>
  )
}

function MenuHeading({ children }: { children: string }) {
  return (
    <p className="text-text-muted px-2 pt-1.5 pb-0.5 text-micro uppercase">
      {children}
    </p>
  )
}

function MenuOption({
  on,
  pick,
  categories,
  thinking,
  label,
  close,
}: {
  on: boolean
  pick: (preset: Preset) => void
  categories: Category[]
  thinking: ThinkingMode
  label: string
  close: () => void
}) {
  const press = useCallback(() => {
    pick({ categories, thinking })
    close()
  }, [pick, categories, thinking, close])
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={press}
      className="hover:bg-surface-hover flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-caption"
    >
      <Tick on={on} />
      <span className="truncate">{label}</span>
    </button>
  )
}

function Tick({ on }: { on: boolean }) {
  return (
    <span aria-hidden="true" className="text-accent-text w-4 shrink-0">
      {on ? '✓' : ''}
    </span>
  )
}
