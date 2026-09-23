import type { TransactionSql } from 'postgres'

// Ticket 57: a Member's own machines, and the name they give them.
//
// The key is the identity and the nickname is a label. `deviceKey` in
// `packages/shared` decides the key — `host:<hostname>` or
// `cloud:<account>[:<type>]` — and nothing here can change it: the column is
// refused by `sessclone_guard_device_columns`, so a rename cannot detach a
// machine from its history. That is the whole reason the two are separate
// columns rather than one editable name.
//
// Whose Devices these are is `devices_read` and `devices_rename`, which are
// not the same policy: a Manager may *see* a Device in their Scope and an
// Owner may see the Org's, while only the Member themselves may rename one.
// This page is the Member's own, so it asks for their own rows.

export type Device = {
  id: string
  key: string
  nickname: string | null
  firstSeenAt: Date
  lastSeenAt: Date
  /** Sessions with a Turn in the last 30 days: the window the page asks
   * about. */
  sessions: number
}

type DeviceRow = {
  id: string
  key: string
  nickname: string | null
  first_seen_at: Date
  last_seen_at: Date
  sessions: string
}

/**
 * A page's worth of machines. A cloud account makes a Device per type and CI
 * containers make more, so the list is capped rather than trusted to stay
 * short; `docs/design/dashboard-wireframes.md` puts no pager on this screen.
 */
export const DEVICE_LIMIT = 50

/**
 * The signed-in Member's own Devices, most recently seen first.
 *
 * The Session count is a correlated aggregate rather than a join and a group by,
 * and it is bounded to the last 30 days on both counts: bounded, it reaches
 * `turns_device_occurred_at_idx` by its leading columns instead of counting a
 * machine's whole history, and thirty days is the question the page asks —
 * "is this machine still reporting", which a last-seen time alone does not
 * answer for a machine that reported once.
 */
export const listOwnDevices = async (
  tx: TransactionSql,
  limit = DEVICE_LIMIT,
): Promise<{ devices: Device[]; more: boolean }> => {
  const rows = await tx<DeviceRow[]>`
    select device.id,
           device.key,
           device.nickname,
           device.first_seen_at,
           device.last_seen_at,
           (select count(distinct (turn.member_id, turn.session_id))
              from turns turn
             where turn.device_id = device.id
               and turn.occurred_at >= now() - interval '30 days') as sessions
      from devices device
     where device.member_id in (select sessclone_own_member_ids())
     order by device.last_seen_at desc
     limit ${limit + 1}
  `

  return {
    devices: rows.slice(0, limit).map((row) => ({
      id: row.id,
      key: row.key,
      nickname: row.nickname,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      sessions: Number(row.sessions),
    })),
    more: rows.length > limit,
  }
}

/**
 * Renames one Device, or clears the name when given nothing.
 *
 * Returns whether a row was written. A rename refused by `devices_rename` —
 * somebody else's machine — touches no rows and raises nothing, so the caller
 * cannot tell "not yours" from "already that" any other way.
 */
export const renameDevice = async (
  tx: TransactionSql,
  deviceId: string,
  nickname: string | null,
): Promise<boolean> => {
  const rows = await tx`
    update devices set nickname = ${nickname}
     where id = ${deviceId}
     returning id
  `
  return rows.length > 0
}
