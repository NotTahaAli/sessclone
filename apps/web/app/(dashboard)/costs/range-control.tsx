import {
  MenuDivider,
  MenuHeading,
  MenuItem,
  PillMenu,
} from '../../_ui/pill-menu'
import { buttonClass, inputClass } from '../../_ui/primitives'
import { hrefWith, type Query } from '../query'
import {
  DEFAULT_PRESET,
  PRESETS,
  type PresetKey,
  type ResolvedRange,
} from '../../../lib/range'
import { addDays, type LocalRange } from '../../../lib/series'

// Ticket 53's control, redrawn as Direction A's header pill (ticket 112): the
// period's name and its dates on the pill, the presets and a custom range in
// the menu under it.
//
// Still links and a `form method="get"`, as ticket 53 built it. The range
// lives in the URL, so choosing one is a navigation: every preset is a real
// link (middle-click, back button, no JavaScript needed to follow it), and the
// custom range is two native date inputs whose form writes the query string
// this page reads.
//
// Every other key in the URL — the Costs view, the Sessions filters, the open
// column — rides along, so changing the month never throws the reader off the
// cut they were reading. Only the page cursor is dropped: it pointed into a
// list that no longer exists.

const readable = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})

/** `2026-09-01` to `2026-10-01` as `1 Sep – 30 Sep`, since `to` is open. */
export const said = (range: LocalRange) => {
  const from = new Date(`${range.from}T00:00:00Z`)
  const last = new Date(`${range.to}T00:00:00Z`)
  last.setUTCDate(last.getUTCDate() - 1)
  return `${readable.format(from)} – ${readable.format(last)}`
}

/** The keys a period owns, which a period link replaces and a form re-sends. */
const PERIOD_KEYS = new Set(['range', 'from', 'to', 'before', 'after'])

export function RangeControl({
  path,
  resolved,
  query,
}: {
  path: string
  resolved: ResolvedRange
  /** The current query, whose other keys every choice here keeps. */
  query: Query
}) {
  const { range, preset } = resolved
  const named = PRESETS.find((item) => item.key === preset)

  return (
    <PillMenu
      label={named?.label ?? 'Custom'}
      detail={said(range)}
      menuLabel="Period"
    >
      {PRESETS.map((item) => (
        <MenuItem
          key={item.key}
          on={preset === item.key}
          href={hrefWith(path, query, periodPatch(item.key))}
        >
          {item.label}
        </MenuItem>
      ))}
      <MenuDivider />
      <MenuHeading>Custom</MenuHeading>
      {/* Two native date inputs and a submit. A `get` form puts its fields
          in the query string itself, which is exactly the URL this page
          reads — no handler, no state. Both show the first and last day
          counted; the half-open end is `resolveRange`'s business. */}
      <form action={path} className="flex flex-col gap-1.5 px-2 pb-2">
        {Object.entries(query).map(([key, value]) => {
          const only = Array.isArray(value) ? value[0] : value
          return only && !PERIOD_KEYS.has(key) ? (
            <input key={key} type="hidden" name={key} value={only} />
          ) : null
        })}
        <label className="text-text-muted flex items-center justify-between gap-2 text-caption">
          From
          <input
            type="date"
            name="from"
            defaultValue={range.from}
            className={`${inputClass} w-36`}
          />
        </label>
        <label className="text-text-muted flex items-center justify-between gap-2 text-caption">
          To
          <input
            type="date"
            name="to"
            defaultValue={addDays(range.to, -1)}
            className={`${inputClass} w-36`}
          />
        </label>
        <button type="submit" className={`${buttonClass()} mt-1 self-end`}>
          Apply
        </button>
      </form>
    </PillMenu>
  )
}

/** A preset replaces whatever period was there, custom dates included. */
const periodPatch = (key: PresetKey) => ({
  range: key === DEFAULT_PRESET ? undefined : key,
  from: undefined,
  to: undefined,
})

export type { PresetKey }
