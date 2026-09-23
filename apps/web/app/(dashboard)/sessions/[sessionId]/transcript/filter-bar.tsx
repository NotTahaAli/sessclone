'use client'

import {
  useCallback,
  useState,
  useTransition,
  type ChangeEvent,
  type FormEvent,
} from 'react'

import {
  ALL,
  CATEGORIES,
  NORMAL,
  type Category,
  type Preset,
  type ThinkingMode,
} from '@sessclone/shared'

import type { SavedPreset } from '../../../../../lib/view-presets'

// Ticket 103: which rows a column shows. A preset is a set of chips plus a
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
  reload,
}: {
  preset: Preset
  onChange: (preset: Preset) => void
  /** The reader's presets; null when they could not be read. */
  saved: SavedPreset[] | null
  onSaved: (saved: SavedPreset[]) => void
  actions: PresetActions | null
  reload: () => void
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

  const pick = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const id = event.target.value
      const next =
        id === 'normal'
          ? NORMAL
          : id === 'all'
            ? ALL
            : list.find((one) => one.id === id)
      if (next) {
        onChange({ categories: next.categories, thinking: next.thinking })
      }
    },
    [list, onChange],
  )

  const think = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const thinking = THINKING.find((mode) => mode === event.target.value)
      if (thinking) onChange({ ...preset, thinking })
    },
    [preset, onChange],
  )

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
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-text-muted text-label uppercase">View</span>
          <select className={control} value={selected} onChange={pick}>
            <option value="normal">Normal</option>
            <option value="all">All</option>
            {list.map((one) => (
              <option key={one.id} value={one.id}>
                {one.name}
                {one.isDefault ? ' (default)' : ''}
              </option>
            ))}
            {selected === 'custom' ? (
              <option value="custom" disabled>
                Custom
              </option>
            ) : null}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-text-muted text-label uppercase">Thinking</span>
          <select className={control} value={preset.thinking} onChange={think}>
            {THINKING.map((mode) => (
              <option key={mode} value={mode}>
                {THINKING_LABEL[mode]}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={reload} className={`${button} ml-auto`}>
          Reload
        </button>
      </div>

      <details>
        <summary className="text-text-secondary hover:text-text w-fit cursor-pointer text-caption">
          Filters · {preset.categories.length} of {CATEGORIES.length} on
        </summary>
        <div className="mt-3 flex flex-col gap-3">
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
      </details>
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
