import Link from 'next/link'

import { buttonClass, inputClass } from '../_ui/primitives'

// A plain GET form: the filter is a URL, so a filtered list can be linked,
// reloaded and gone back to. No client component and no state — the server
// already re-renders with what the query names.

export function TextFilter({
  name,
  label,
  value,
  placeholder,
  clearHref,
}: {
  /** The query parameter, which is also the field's name. */
  name: string
  label: string
  value: string
  placeholder: string
  /** Where "Clear" goes: the same page with no query. */
  clearHref: string
}) {
  return (
    <form className="flex flex-wrap items-center gap-2">
      {/* The label is the field's name for a screen reader; the placeholder
          carries it for everyone else, as the header pills do. */}
      <label className="sr-only" htmlFor={`filter-${name}`}>
        {label}
      </label>
      <input
        id={`filter-${name}`}
        name={name}
        defaultValue={value}
        placeholder={`${label}, e.g. ${placeholder}`}
        className={`${inputClass} w-80 max-w-full`}
      />
      <button type="submit" className={buttonClass()}>
        Filter
      </button>
      {value ? (
        <Link
          href={clearHref}
          className="text-text-muted text-caption underline"
        >
          Clear
        </Link>
      ) : null}
    </form>
  )
}
