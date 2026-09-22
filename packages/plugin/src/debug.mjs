// Why every hook swallows its failures, and the one way to see them.
//
// A hook that reports a failure reports it into the session, once per turn, to
// somebody who is working on something else — so a deployment that is briefly
// unreachable would fill a transcript with notices about a retry queue that is
// already handling it. Hence the silent catches in `hooks/`, which are
// deliberate.
//
// What they also hid was a failure nothing recovered from: the plugin imported
// a path outside its own directory, so every installed copy threw
// `ERR_MODULE_NOT_FOUND` before sending anything, and the only symptom was a
// Collector that started cleanly and collected nothing at all. There was no
// way to see it short of running a hook by hand.
//
// So the catches stay silent and gain one escape hatch, which a person sets
// when they are already looking.

/**
 * Writes `what` failed and why to stderr, but only under `SESSCLONE_DEBUG`.
 *
 * The error's own message and nothing else: it names a module, a host or a
 * status, all of which are worth reading. The configuration is never passed
 * in, because it holds the key and a hook's stderr lands in the transcript
 * this product uploads.
 *
 * @param {string} what The hook, and what it was doing.
 * @param {unknown} error
 * @param {Record<string, string | undefined>} [environment]
 */
export const debugFailure = (what, error, environment = process.env) => {
  if (!environment.SESSCLONE_DEBUG) return
  // `String(error)` rather than the template's own coercion, which the linter
  // refuses on an `unknown`: the message is for a person, and an error whose
  // `toString` is useless is still better than no line at all.
  process.stderr.write(`sessclone: ${what} failed: ${String(error)}\n`)
}
