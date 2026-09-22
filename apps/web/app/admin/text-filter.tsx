import Link from 'next/link'

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
    <form className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-caption">
        {label}
        <input
          name={name}
          defaultValue={value}
          placeholder={placeholder}
          className="border-control-border text-text rounded border px-3 py-1 font-mono text-sm"
        />
      </label>
      <button
        type="submit"
        className="border-control-border text-text rounded border px-3 py-1 text-sm"
      >
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
