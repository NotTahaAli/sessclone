// Which Device a Turn was collected from.
//
// A laptop answers this by itself: it has a machine identity that survives a
// reboot, and ticket 30 turns that into the machine key this function is
// handed. A cloud environment does not. Claude Code Cloud and Claude Projects
// both run each session in a container built from scratch, so every identifier
// reachable from a hook process — `/etc/machine-id`, the hostname — is minted
// at boot and gone by the next one. Keying on it mints a new Device per
// container and turns the per-Device breakdown into noise.
//
// The stable handle those environments do have, their environment id, is only
// reachable from inside the session, not from the hook process that reports.
// So the Member supplies it as configuration, once, where that environment's
// variables are set — for Claude Projects, the environment settings on
// claude.ai rather than a shell profile.

export type DeviceKeySource =
  // The Member named this Device. Stable by construction.
  | 'configured'
  // A real machine's own identity.
  | 'machine'
  // A cloud environment that named no Device: the key is this container's, and
  // the next container will mint another. Recorded rather than hidden, so the
  // churn is legible as churn instead of as a fleet of laptops.
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

  return {
    key: machineKey,
    source: env.CLAUDE_CODE_REMOTE === 'true' ? 'container' : 'machine',
  }
}
