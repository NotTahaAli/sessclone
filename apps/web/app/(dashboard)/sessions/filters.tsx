import {
  MenuDivider,
  MenuHeading,
  MenuItem,
  PillMenu,
} from '../../_ui/pill-menu'
import { buttonClass, inputClass } from '../../_ui/primitives'
import { hrefWith, one, type Query } from '../query'

// Ticket 86's two filters, ticket 92's shelf and ticket 93's two — as two
// header pills (ticket 112) instead of a row of selects and a Filter button.
//
// Still navigations, as they were a `get` form before: every choice is a
// link whose URL is the query this page reads, so a filter can be sent,
// middle-clicked and undone with back, and following one needs no JavaScript.
// The search box is the one field, and it is a `get` form for the same
// reason. Each link keeps the period and the other filters (`hrefWith`), and
// closes the open column, whose Session the new filter may not list.

/** Ticket 92's shelves. Hidden is not among them, on purpose: hidden means no
 * list, and an option for it would make it a second archive. */
const SHELVES = [
  { value: undefined, label: 'Listed' },
  { value: 'archived', label: 'Archived' },
] as const

/** Keys the search form must not re-send as hidden fields. */
const OWN = new Set(['q', 'before', 'open'])

export function SessionFilters({
  projects,
  people,
  project,
  member,
  state,
  search,
  failed,
  params,
}: {
  projects: { id: string; key: string }[]
  people: { id: string; email: string }[]
  project: string | undefined
  member: string | undefined
  state: string | undefined
  search: string | undefined
  failed: boolean
  params: Query
}) {
  const to = (patch: Record<string, string | undefined>) =>
    hrefWith('/sessions', params, { ...patch, open: undefined })

  const who = people.find((row) => row.id === member)?.email
  const where =
    project === 'none'
      ? 'outside a repository'
      : projects.find((row) => row.id === project)?.key

  return (
    <>
      {/* Who and where. A Project or a person the viewer may not read is
          simply not in the list — `projects_read` and `members_read` decided
          what `sessionFilters` returned. */}
      <PillMenu
        label={who ?? 'Everyone'}
        detail={[where, search ? `“${search}”` : null]
          .filter(Boolean)
          .join(' · ')}
        menuLabel="Filter sessions"
      >
        {/* Ticket 93. `type="search"`, which gets the clear affordance and the
            right keyboard on a phone for free. */}
        <form action="/sessions" className="flex gap-1.5 px-1 pt-1 pb-1.5">
          {Object.entries(params).map(([key, value]) => {
            const only = one(value)
            return only && !OWN.has(key) ? (
              <input key={key} type="hidden" name={key} value={only} />
            ) : null
          })}
          <label htmlFor="filter-q" className="sr-only">
            Search sessions
          </label>
          <input
            id="filter-q"
            name="q"
            type="search"
            defaultValue={search ?? ''}
            placeholder="Name or session id"
            className={`${inputClass} w-full`}
          />
          <button type="submit" className={buttonClass()}>
            Find
          </button>
        </form>
        <MenuHeading>Person</MenuHeading>
        <MenuItem on={!member} href={to({ member: undefined })}>
          Everyone
        </MenuItem>
        {people.map((row) => (
          <MenuItem
            key={row.id}
            on={member === row.id}
            href={to({ member: row.id })}
          >
            <span className="truncate">{row.email}</span>
          </MenuItem>
        ))}
        <MenuDivider />
        <MenuHeading>Project</MenuHeading>
        <MenuItem on={!project} href={to({ project: undefined })}>
          Any project
        </MenuItem>
        {/* The Sessions that ran outside a repository are a group rather
            than a gap, so they are a choice of their own. */}
        <MenuItem on={project === 'none'} href={to({ project: 'none' })}>
          Outside a repository
        </MenuItem>
        {projects.map((row) => (
          <MenuItem
            key={row.id}
            on={project === row.id}
            href={to({ project: row.id })}
          >
            <span className="truncate font-mono text-caption">{row.key}</span>
          </MenuItem>
        ))}
      </PillMenu>

      {/* Which shelf, and whether only failed Sessions. "Listed" and
          "archived" are two shelves rather than one thing on or off. */}
      <PillMenu
        label={state === 'archived' ? 'Archived' : 'Listed'}
        detail={failed ? 'failed only' : undefined}
        menuLabel="Shelf"
      >
        <MenuHeading>Shelf</MenuHeading>
        {SHELVES.map((shelf) => (
          <MenuItem
            key={shelf.label}
            on={state === shelf.value}
            href={to({ state: shelf.value })}
          >
            {shelf.label}
          </MenuItem>
        ))}
        <MenuDivider />
        <MenuItem on={failed} href={to({ failed: failed ? undefined : '1' })}>
          Failed only
        </MenuItem>
      </PillMenu>
    </>
  )
}
