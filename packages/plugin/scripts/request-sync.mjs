// `/sessclone:sync`: ask for a full push at the end of this turn.
//
// Only a hook holds the key (see `status.mjs`), so this leaves a request in
// the state directory and the `Stop` hook that ends this very turn drains the
// queue and re-sends every session's unsent Turns, then says what it did.
// Always exit 0.

try {
  const { requestSync } = await import('../src/sync.mjs')
  const { defaultStateDir } = await import('../src/configuration.mjs')
  const stateDir =
    process.env.SESSCLONE_STATE_DIR?.trim() ||
    defaultStateDir(process.platform, process.env)
  if (!stateDir) throw new Error('no state directory on this platform')
  await requestSync(stateDir)
  console.log('Sync requested: it runs as soon as this reply ends.')
} catch (error) {
  console.log(`sessclone sync could not be requested: ${String(error)}`)
}
