import Link from 'next/link'

import {
  PRESETS,
  presetHref,
  type PresetKey,
  type ResolvedRange,
} from '../../../lib/range'
import { addDays, type LocalRange } from '../../../lib/series'

// Ticket 53's control, and it is links and a `form method="get"` rather than a
// client component.
//
// The range lives in the URL, so choosing one is a navigation — which is what
// a link is. That makes every preset a real link: middle-click opens the
// period in a tab, the browser's back button undoes a choice, and a reader
// with JavaScript off still has the control. A `<select>` wired to a router
// push would be the same thing with more moving parts and none of those
// properties.
//
// It sits above the views rather than inside the chart, because it holds the
// range for every Costs view and persists across the tab switch: the reader is
// asking one question about one period and changing the breakdown. Tickets 54
// to 56 render this and pass the resolved range down; they do not parse the
// URL again.

const readable = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

/** `2026-09-01` to `2026-10-01` as `1 Sep – 30 Sep 2026`, since `to` is open. */
const said = (range: LocalRange) => {
  const from = new Date(`${range.from}T00:00:00Z`)
  const last = new Date(`${range.to}T00:00:00Z`)
  last.setUTCDate(last.getUTCDate() - 1)
  return `${readable.format(from)} – ${readable.format(last)}`
}

export function RangeControl({
  path,
  resolved,
}: {
  path: string
  resolved: ResolvedRange
}) {
  const { range, preset } = resolved

  return (
    <section
      aria-labelledby="range"
      className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"
    >
      <div>
        <h2 id="range" className="text-label text-text-muted uppercase">
          Period
        </h2>
        <p className="mt-1 font-mono text-sm">{said(range)}</p>
      </div>

      <div className="flex flex-col gap-2 sm:items-end">
        <ul className="flex flex-wrap gap-2">
          {PRESETS.map((item) => (
            <li key={item.key}>
              <Choice
                href={presetHref(path, item.key)}
                label={item.label}
                current={preset === item.key}
              />
            </li>
          ))}
        </ul>

        {/* Two native date inputs and a submit. A `get` form puts its fields
            in the query string itself, which is exactly the URL this page
            reads — no handler, no state, no client module. */}
        <form
          action={path}
          className="flex flex-wrap items-end gap-2"
          aria-label="Custom period"
        >
          <Field name="from" label="From" value={range.from} />
          <Field name="to" label="To" value={addDays(range.to, -1)} />
          <button
            type="submit"
            className="border-control-border text-text h-8 rounded border px-3 text-caption"
          >
            Apply
          </button>
        </form>
      </div>
    </section>
  )
}

function Choice({
  href,
  label,
  current,
}: {
  href: string
  label: string
  current: boolean
}) {
  return (
    <Link
      href={href}
      // The current period is marked with the accent edge the nav uses, and
      // `aria-current` says the same thing to a reader who cannot see it.
      aria-current={current ? 'true' : undefined}
      className={`flex h-8 items-center rounded border px-3 text-caption ${
        current
          ? 'border-accent-border text-accent-text'
          : 'border-rule text-text-secondary hover:bg-surface-hover'
      }`}
    >
      {label}
    </Link>
  )
}

/**
 * One end of a custom period.
 *
 * `type="date"` rather than a picker component: the platform ships one, it is
 * localised, it is reachable from a keyboard, and it is the rung this repo
 * takes before writing a control of its own.
 *
 * Both fields show and submit the same thing: the first and last day counted.
 * The half-open end `LocalRange` carries is `resolveRange`'s business, so
 * neither field displays a date the reader did not choose.
 */
function Field({
  name,
  label,
  value,
}: {
  name: string
  label: string
  value: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={`range-${name}`} className="text-text-muted text-micro">
        {label}
      </label>
      <input
        id={`range-${name}`}
        type="date"
        name={name}
        defaultValue={value}
        className="border-control-border text-text h-8 rounded border px-2 text-caption"
      />
    </div>
  )
}

export type { PresetKey }
