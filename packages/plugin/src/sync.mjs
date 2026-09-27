// A person's `/sessclone:sync`, carried from the command to the `Stop` hook.
//
// The command cannot send (only hooks are given the key), so it drops this
// file and the `Stop` hook ending the same turn picks it up. One file, taken
// by rename so two hooks never both run the sweep.

import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const FILE = 'sync-requested'

/** @param {string} stateDir */
export const requestSync = async (stateDir) => {
  await mkdir(stateDir, { recursive: true })
  await writeFile(join(stateDir, FILE), new Date().toISOString())
}

/**
 * Takes the request if there is one. True at most once per request.
 *
 * @param {string} stateDir
 */
export const takeSyncRequest = async (stateDir) => {
  const taken = join(stateDir, `${FILE}.${process.pid}`)
  try {
    await rename(join(stateDir, FILE), taken)
  } catch {
    return false
  }
  await rm(taken, { force: true })
  return true
}
