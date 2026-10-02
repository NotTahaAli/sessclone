/** What `scripts/status.mjs --json` prints, and the session it was asked about. */
export type Standing = {
  url: string | null
  connection: 'connected' | 'refused' | 'unchecked'
  org: string | null
  checkedAt: string | null
  oldNode: boolean
  queued: number
  unsent: number | null
  lastPush: { status: number | null; at: string } | null
  sessionId: string
}

declare module 'claude-code' {
  interface PluginState {
    sessclone: { standing: Standing | null }
  }
}
