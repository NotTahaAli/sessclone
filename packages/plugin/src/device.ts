// Which Device a Turn was collected from.
//
// A laptop answers this by itself: it has a machine identity that survives a
// reboot, and ticket 30 turns that into the machine key this function is
// handed. A cloud environment does not. Claude Code Cloud and Claude Projects
// both run each session in a container built from scratch, so `/etc/machine-id`
// and the hostname are minted at boot and gone by the next one. Keying on one
// of those mints a new Device per container and turns the per-Device breakdown
// into noise.
//
// What a cloud environment does carry is the account: Claude Code sets
// `CLAUDE_CODE_ACCOUNT_UUID`, and it outlives the container that reads it.
// Ticket 30 asks for exactly that — a cloud environment keyed by account, not
// container — so it is the default here.
//
// `SESSCLONE_DEVICE` is the override, for a Member who wants one account's
// several environments counted apart rather than as one Device. In a Claude
// Projects environment it is set in the environment settings on claude.ai
// rather than in a shell profile, because a session cannot set a variable for
// the container that replaces it.

export type DeviceKeySource =
  // The Member named this Device. Stable by construction.
  | 'configured'
  // A real machine's own identity.
  | 'machine'
  // A cloud environment keyed by the account running it: stable across
  // containers, and one Device for every environment that account has.
  | 'account'
  // A cloud environment with neither. The key is this container's and the next
  // container mints another; recorded rather than hidden, so the churn is
  // legible as churn instead of as a fleet of laptops.
  | 'container'

export type DeviceKey = { key: string; source: DeviceKeySource }

export const deviceKey = (
  env: Record<string, string | undefined>,
  machineKey: string,
): DeviceKey => {
  // Trimmed, because `SESSCLONE_DEVICE=` in an environment file is set-but-
  // empty, which reads as a choice and is not one.
  const configured = env.SESSCLONE_DEVICE?.trim()
  if (configured) return { key: configured, source: 'configured' }

  if (env.CLAUDE_CODE_REMOTE !== 'true') {
    return { key: machineKey, source: 'machine' }
  }

  // Prefixed, so an account key and a machine key can never collide in the
  // Devices table however ticket 30 later spells the machine one.
  const account = env.CLAUDE_CODE_ACCOUNT_UUID?.trim()
  return account
    ? { key: `account:${account}`, source: 'account' }
    : { key: machineKey, source: 'container' }
}
