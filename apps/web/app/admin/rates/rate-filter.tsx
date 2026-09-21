import Link from 'next/link'

// A plain GET form: the filter is a URL, so a filtered list can be linked,
// reloaded and gone back to. No client component and no state — the server
// already re-renders with what the query names.

export function RateFilter({ model }: { model: string }) {
  return (
    <form className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-caption">
        Filter by model
        <input
          name="model"
          defaultValue={model}
          placeholder="opus"
          className="border-control-border text-text rounded border px-3 py-1 font-mono text-sm"
        />
      </label>
      <button
        type="submit"
        className="border-control-border text-text rounded border px-3 py-1 text-sm"
      >
        Filter
      </button>
      {model ? (
        <Link
          href="/admin/rates"
          className="text-text-muted text-caption underline"
        >
          Clear
        </Link>
      ) : null}
    </form>
  )
}
