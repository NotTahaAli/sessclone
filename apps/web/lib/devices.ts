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
  /** Null until something has reported, which is not the same as zero. */
  turns: number
}

type DeviceRow = {
  id: string
  key: string
  nickname: string | null
  first_seen_at: Date
  last_seen_at: Date
  turns: string
}

/**
 * The signed-in Member's own Devices, most recently seen first.
 *
 * The Turn count is a correlated aggregate rather than a join and a group by:
 * a Member has a handful of machines, and `turns_member_occurred_at_idx`
 * answers each count from the index. It is here because "is this machine
 * actually reporting" is the question the page exists to answer, and a
 * last-seen time alone does not distinguish a machine that reported once from
 * one that reports all day.
 */
export const listOwnDevices = async (tx: TransactionSql): Promise<Device[]> => {
  const rows = await tx<DeviceRow[]>`
    select device.id,
           device.key,
           device.nickname,
           device.first_seen_at,
           device.last_seen_at,
           (select count(*) from turns turn where turn.device_id = device.id)
             as turns
      from devices device
     where device.member_id in (select sessclone_own_member_ids())
     order by device.last_seen_at desc
  `

  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    nickname: row.nickname,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    turns: Number(row.turns),
  }))
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
