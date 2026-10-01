# 160: Old Node says so, and the fix

**What to build:** coordinator, 2026-10-01, overnight while Taha slept. The
Collector needs Node 22.18+ (or 23.6+, or 24) because the hooks import
`packages/shared` as TypeScript. An older install must tell its person rather
than lose their data quietly.

**What was found.** Session start already refused on old Node, but as "installed
but not configured", with no fix and a doubled full stop. And
`stop-archive.mjs` imported `archive.mjs` at the top, so on old Node in a cloud
container it threw `ERR_UNKNOWN_FILE_EXTENSION` with a stack trace after every
turn, into the transcript this product uploads.

**What was decided.**

- Session start checks Node first, on its own line: the Node it found, that
  nothing is collected, and the fix (a newer `node` on Claude Code's PATH, then
  a restart; in a cloud container, its setup script). Exit 2, every session
  until fixed. On a machine, the sweep sends sessions from meanwhile over the
  next session starts, while Claude Code still keeps them; a cloud container's
  sessions leave with it, so none are promised there.
- `scripts/verify-collector.mjs` checks Node before importing `verify.mjs`, so
  it names the old Node instead of crashing on it.
- `stop-archive.mjs` imports `archive.mjs` lazily inside its `try`, like every
  other hook. A test runs each per-turn hook under
  `--no-experimental-strip-types` and expects silence and exit 0.
- No Devices-page flag: an old-Node install never reaches the deployment, so
  the dashboard has nothing to show. The session-start line is where the person
  is looking.
- Released as 0.4.1.

**Status:** done

- [x] Session-start Node line with the fix, test red without it (old Node
      faked by overriding `process.versions`)
- [x] Quiet per-turn archive hook on old Node, test red without it
