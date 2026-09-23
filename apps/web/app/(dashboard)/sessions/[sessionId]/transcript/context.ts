'use client'

import { createContext, useContext } from 'react'

import type { Item, JournalAgent, ThinkingMode } from '@sessclone/shared'

import type { Column } from './columns'
import { EMPTY_HEARTH, type Hearth } from './hearth'
import type { StoredFile, TurnCost } from './data'

/** What every row can reach without being handed it through each level. */
export type Viewer = {
  clock: Intl.DateTimeFormat
  /** The Session's first timestamp, for "+4m 05s" in a row's details. */
  sessionStart: string | null
  thinking: ThinkingMode
  showToolOutput: boolean
  transcriptFor: (agentId: string) => StoredFile | undefined
  journalFor: (runId: string) => StoredFile | undefined
  /** Cached per file for this load; a Reload starts a new cache. */
  agentItems: (agentId: string) => Promise<Item[]> | null
  journal: (runId: string) => Promise<JournalAgent[]> | null
  /** One lookup per Session, made the first time an info panel opens. */
  costs: () => Promise<Record<string, TurnCost>>
  /** Key of the column open right after column `index`, if any. */
  openAfter: (index: number) => string | undefined
  toggle: (from: number, column: Column) => void
}

export const ViewerContext = createContext<Viewer | null>(null)

export const useViewer = () => {
  const viewer = useContext(ViewerContext)
  if (!viewer) throw new Error('useViewer outside TranscriptViewer')
  return viewer
}

/**
 * Latest `<task-notification>` status per background agent id, from the
 * column the blocks sit in: a background agent's own file cannot say it
 * finished, the parent's notification does.
 */
export const TaskStatusContext = createContext<ReadonlyMap<string, string>>(
  new Map(),
)

/** Which column a row sits in, and whose costs its messages are filed under. */
export const ColumnContext = createContext<{
  index: number
  agentId: string | null
}>({ index: 0, agentId: null })

/** Every Item loaded in the column, for rows that look back (an artifact's HTML). */
export const ItemsContext = createContext<readonly Item[]>([])

/** The column's hearthbot calls: which reply made which message, its edits and emoji. */
export const HearthContext = createContext<Hearth>(EMPTY_HEARTH)
