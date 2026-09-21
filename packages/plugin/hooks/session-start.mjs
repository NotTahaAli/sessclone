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
// Exit 2, which on this event is both non-blocking and the only code that
// shows the whole message. The hooks reference is explicit on each half: a
// non-zero, non-2 exit surfaces only the *first line* of stderr, behind a
// generic error notice, with the rest available solely under `claude --debug`
// — which would drop every `- SESSCLONE_API_KEY is …` line, the one part of
// this that tells somebody what to fix. And `SessionStart` is one of the
// events that cannot be blocked, so 2 shows the message and execution
// continues; it stops nobody working. The key itself never appears either way
// (see `ConfigurationError`).
//
// Later tickets grow this hook into the sweep the spec describes (§5.2): drain
// the retry queue and re-send unfinished sessions. Both need the configuration
// this reads, which is why the check lands here rather than in a hook of its
// own.

import { ConfigurationError, readConfiguration } from '../src/configuration.mjs'

try {
  readConfiguration()
} catch (error) {
  if (!(error instanceof ConfigurationError)) throw error

  process.stderr.write(
    `sessclone is installed but not configured, so nothing will be collected from this machine.\n${error.problems
      .map((problem) => `  - ${problem}`)
      .join('\n')}\nSee docs/configuration.md for the full list.\n`,
  )
  process.exit(2)
}
