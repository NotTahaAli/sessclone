import type postgres from 'postgres'

// Ticket 72: the statements behind ADR 0005's two controls — a Member's
// archival master switch, and the per-Project exceptions that sit inside it.
//
// They live here rather than in the Server Actions for the reason ticket 28
// gives in `lib/api-keys.ts`: a Server Action wants `cookies()` and a request,
// so SQL written inside one is SQL nothing proves. Each function takes the
// transaction; the page passes the one `asViewer` opens and
// `test/archival.test.ts` passes the one `asUser` opens, so the policy the
// test exercises is the policy the page runs under.
//
// Note what is *not* here: no `where member_id = <the signed-in person>`.
// `members_write`, its column guard trigger and `member_project_archival_own`
// are what decide whose settings these are (ADR 0001). Every statement below
// still intersects the id it was handed with `sessclone_own_member_ids()`,
// because a Server Action's `memberId` is a claim from the browser and not a
// fact — the same treatment `createApiKey` gives its membership.

/** One Org's switch. A person in two Orgs has two, because `members` does. */
export type ArchivalMembership = {
  member_id: string
  org_id: string
  org_name: string
  archival_enabled: boolean
}

export type ArchivalProject = {
  member_id: string
  project_id: string
  /** The Project key: a normalised git remote, or `local:<host>:<path>`. */
  key: string
  /** What git actually reported, credentials stripped. Null for a `local:` key. */
  remote: string | null
  /**
   * The exception row's value, or null when the Project has no row and so
   * inherits the master switch. ADR 0005 makes this an opt-out list.
   */
  archival_enabled: boolean | null
}

/**
 * The viewer's memberships and their master switches, oldest Org first.
 *
 * `sessclone_own_member_ids()` is the filter, so this is the database
 * answering "who is this" rather than the caller asserting it.
 */
export const listArchivalMemberships = (tx: postgres.TransactionSql) =>
  tx<ArchivalMembership[]>`
    select member.id as member_id, org.id as org_id, org.name as org_name,
           member.archival_enabled
      from members member
      join orgs org on org.id = member.org_id
     where member.id in (select sessclone_own_member_ids())
     order by member.created_at
  `

/**
 * Every Project the viewer could archive from, per membership, by key.
 *
 * Ticket 72 asks for every Project the Member has Sessions in, so an exclusion
 * can be made without guessing a key — `local:` ones included, which is most
 * of why the list exists at all: those keys carry a hostname and an absolute
 * path that nobody would type correctly from memory.
 *
 * Derived from the Member's own Turns, and only from them. That is also what
 * `sessclone_visible_project_ids()` will show a Member, so a list built any
 * other way would name rows the join then drops. It leaves no setting
 * stranded: nothing deletes a Turn — Retention ages out Log Artifacts, and a
 * deleted Project cascades its exceptions away with it — so a Project with an
 * exception row is a Project with Turns.
 */
export const listArchivalProjects = (tx: postgres.TransactionSql) =>
  tx<ArchivalProject[]>`
    select distinct turn.member_id, project.id as project_id,
           project.key, project.remote, exception.archival_enabled
      from turns turn
      join projects project on project.id = turn.project_id
      left join member_project_archival exception
        on exception.member_id = turn.member_id
       and exception.project_id = project.id
     where turn.member_id in (select sessclone_own_member_ids())
     order by project.key
  `

/**
 * Turns the master switch on or off for one of the viewer's own memberships.
 *
 * Off is forward-only, which is ADR 0005 and what the surface says: it stops
 * new uploads and leaves what is stored, to age out under Retention. Nothing
 * here deletes.
 *
 * Returns how many rows changed, so a caller can tell a refusal from a no-op.
 */
export const setArchivalEnabled = async (
  tx: postgres.TransactionSql,
  memberId: string,
  enabled: boolean,
) => {
  const updated = await tx`
    update members set archival_enabled = ${enabled}
     where id = ${memberId}
       and id in (select sessclone_own_member_ids())
  `
  return updated.count
}

/**
 * Includes or excludes one Project for one of the viewer's own memberships.
 *
 * A row is written either way rather than deleted on re-inclusion: an explicit
 * `true` and an inherited `true` mean the same thing to the presign route, and
 * one statement is easier to be sure of than an upsert and a delete that have
 * to agree.
 *
 * `org_id` comes from the `members` row rather than from the caller, and the
 * table's `(org_id, project_id)` foreign key is what refuses a Project from
 * another Org — so a guessed id inserts nothing rather than proving the
 * Project exists.
 */
export const setProjectArchival = async (
  tx: postgres.TransactionSql,
  memberId: string,
  projectId: string,
  enabled: boolean,
) => {
  const written = await tx`
    insert into member_project_archival
      (org_id, member_id, project_id, archival_enabled)
    select member.org_id, member.id, ${projectId}, ${enabled}
      from members member
     where member.id = ${memberId}
       and member.id in (select sessclone_own_member_ids())
    on conflict (member_id, project_id) do update
      set archival_enabled = excluded.archival_enabled, updated_at = now()
  `
  return written.count
}
