// Ticket 86's two filters, as a `form method="get"`.
//
// The same shape as the custom period beside it: a `get` form puts its fields
// in the query string, which is exactly the URL this page reads — no handler,
// no state, no client module, and it works with JavaScript off. Changing a
// filter is a navigation, which is what the browser already does well.
//
// The period rides along as hidden fields. Without them, picking a Project
// would silently throw the reader back to this month — answering a different
// question than the one they asked, which is the failure `viewHref` and
// `presetHref` exist to prevent everywhere else.

/** One object, rather than a new one on every render. */
const NO_PROJECT = { value: 'none', label: 'Outside a repository' }

export function SessionFilters({
  projects,
  people,
  project,
  member,
  params,
}: {
  projects: { id: string; key: string }[]
  people: { id: string; email: string }[]
  project: string | undefined
  member: string | undefined
  params: Record<string, string | string[] | undefined>
}) {
  const carried: [string, string][] = []
  for (const key of ['range', 'from', 'to'] as const) {
    const value = params[key]
    const only = Array.isArray(value) ? value[0] : value
    if (only) carried.push([key, only])
  }

  // Built here rather than inline: a new array in a prop on every render is
  // what the repo's lint rule refuses, and for the usual reason.
  const projectOptions = [
    // The Sessions that ran outside a repository are a group rather than a
    // gap, so they are selectable rather than only reachable by having no
    // filter at all.
    NO_PROJECT,
    ...projects.map((row) => ({ value: row.id, label: row.key })),
  ]
  const peopleOptions = people.map((row) => ({
    value: row.id,
    label: row.email,
  }))

  return (
    <form
      action="/sessions"
      aria-label="Filter sessions"
      className="flex flex-wrap items-end gap-2"
    >
      {carried.map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}

      {choice('project', 'Project', project, projectOptions)}
      {choice('member', 'Person', member, peopleOptions)}

      <button
        type="submit"
        className="border-control-border text-text h-8 rounded border px-3 text-caption"
      >
        Filter
      </button>
    </form>
  )
}

/**
 * One `select`, with "Any" as its first option rather than a separate Clear
 * button: clearing a filter and choosing one are the same gesture, and a
 * second control would be a second thing to find on a phone.
 *
 * A Project or a person the viewer may not read is simply not in the list —
 * `projects_read` and `members_read` decide what `sessionFilters` returned,
 * and a filter offering a name whose rows are refused would be a surface
 * telling the reader something the policies do not.
 *
 * A function returning markup rather than a component taking props, because
 * the options are a list built from a read: handing a fresh array to a
 * component on every render is what this repo's `react-perf` rule refuses,
 * and it is refusing something real. Called twice, so the markup is still
 * written once.
 */
const choice = (
  name: string,
  label: string,
  value: string | undefined,
  options: { value: string; label: string }[],
) => {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={`filter-${name}`} className="text-text-muted text-micro">
        {label}
      </label>
      <select
        id={`filter-${name}`}
        name={name}
        defaultValue={value ?? ''}
        className="border-control-border text-text h-8 max-w-[14rem] rounded border px-2 text-caption"
      >
        <option value="">Any</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}
