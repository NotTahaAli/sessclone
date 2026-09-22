// Ticket 32: the Collector checks its configuration once, at the start of a
// session, and says so where a person will see it.
//
// `SessionStart` is the right moment for two reasons. It is the first thing
// that runs after the restart the install instructions ask for, so a key
// pasted wrong is reported before the Member has written a single turn — and
// it fires once per session rather than once per turn, which is what makes a
// non-zero exit tolerable here and not in `stop.mjs`. That hook swallows every
// failure precisely because a hook error notice on every turn is a poor way to
// report that a deployment is down; a notice once, at startup, naming the
// variable to fix, is the loud failure this ticket asks for.
//
// Exit 2, and everything worth reading on the first line of stderr.
//
// The hooks reference documents `SessionStart` as an event that cannot be
// blocked — "shows stderr to user only", and the session proceeds — so 2 stops
// nobody working, which is what exit 1 was chosen for. What 1 also did was
// hide the message: a non-zero, non-2 exit renders a generic notice and then
// the *first line* of stderr, with the rest only under `claude --debug`. The
// reference describes the exit-2 rendering on this event the same way, so
// rather than depend on which of them shows more, the problems are joined into
// that first line. The key itself never appears either way (see
// `ConfigurationError`).
//
// This hook is also the sweep the spec describes (§5.2, ticket 39): once the
// configuration is known good, drain the retry queue and re-send every session
// this environment has written that is not known to be complete. Both need the
// configuration this reads, which is why they land here rather than in a hook
// of their own.

import { ConfigurationError, readConfiguration } from '../src/configuration.mjs'
import { debugFailure } from '../src/debug.mjs'
import { throughProxy } from '../src/proxy.mjs'

// Ticket 97: before anything is read or sent, so the child gets stdin whole.
throughProxy()

let configuration
try {
  configuration = readConfiguration()
} catch (error) {
  if (!(error instanceof ConfigurationError)) throw error

  process.stderr.write(
    `sessclone is installed but not configured, so nothing will be collected from this machine: ${error.problems.join(
      '; ',
    )}. See docs/configuration.md.\n`,
  )
  process.exit(2)
}

// The configuration is good. Recover what an earlier session could not push:
// the retry queue, then each session from its cursor, time-boxed inside the
// hook's budget. Silent and exit 0, and the lazy import, for the reasons
// `stop.mjs` gives — an old Node cannot load `report.mjs`'s TypeScript imports,
// and a hook's stderr lands in the transcript this product uploads.
try {
  const { sweep } = await import('../src/report.mjs')
  const swept = new Date()
  await sweep({ configuration, environment: process.env })

  // Ticket 97: a refused key is otherwise silent forever. Exit 2 shows this
  // line to the person and blocks nothing, as the configuration check does.
  const { readAnswer, refusalNotice } = await import('../src/last-answer.mjs')
  const notice = refusalNotice(await readAnswer(configuration.stateDir), swept)
  if (notice) {
    process.stderr.write(`${notice}\n`)
    process.exitCode = 2
  }
} catch (error) {
  // Deliberately silent unless somebody is looking: see `src/debug.mjs`.
  debugFailure('the SessionStart sweep', error)
}
