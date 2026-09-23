import type { TransactionSql } from 'postgres'

import type { Category, ThinkingMode } from '@sessclone/shared'

// Tickets 102-104: a person's saved transcript-viewer presets. Every statement
// names the viewer through `sessclone_user_id()` rather than a parameter, and
// `transcript_view_presets_own` refuses anybody else's row besides.

export type SavedPreset = {
  id: string
  name: string
  categories: Category[]
  thinking: ThinkingMode
  isDefault: boolean
}

type Row = {
  id: string
  name: string
  categories: Category[]
  thinking: ThinkingMode
  is_default: boolean
}

const toPreset = (row: Row): SavedPreset => ({
  id: row.id,
  name: row.name,
  categories: row.categories,
  thinking: row.thinking,
  isDefault: row.is_default,
})

export const listPresets = async (tx: TransactionSql) =>
  (
    await tx<Row[]>`
      select id, name, categories, thinking, is_default
        from transcript_view_presets
       where user_id = (select sessclone_user_id())
       order by name
    `
  ).map(toPreset)

/** Upsert by name: saving under an existing name replaces that preset. */
export const savePreset = async (
  tx: TransactionSql,
  preset: { name: string; categories: Category[]; thinking: ThinkingMode },
) => {
  const [row] = await tx<Row[]>`
    insert into transcript_view_presets (user_id, name, categories, thinking)
    values (sessclone_user_id(), ${preset.name},
            ${preset.categories}::text[], ${preset.thinking})
    on conflict (user_id, name) do update
       set categories = excluded.categories, thinking = excluded.thinking
    returning id, name, categories, thinking, is_default
  `
  return toPreset(row!)
}

export const deletePreset = async (tx: TransactionSql, id: string) =>
  (await tx`delete from transcript_view_presets where id = ${id}`).count > 0

/**
 * Makes one preset the default, or none. Two statements because the
 * one-default index is checked per row: setting the new one before clearing
 * the old would trip it. Returns false when `id` is not the viewer's.
 */
export const setDefaultPreset = async (
  tx: TransactionSql,
  id: string | null,
) => {
  await tx`
    update transcript_view_presets set is_default = false
     where is_default and user_id = (select sessclone_user_id())
  `
  if (id === null) return true
  const set = await tx`
    update transcript_view_presets set is_default = true where id = ${id}
  `
  return set.count > 0
}
