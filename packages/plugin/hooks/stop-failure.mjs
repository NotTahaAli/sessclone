// Ticket 40: the turn that ended on an API error rather than on an answer.
//
// A subscription is not billed per token, so "did I hit the limit" is the
// question that Member actually has, and nothing else in the product can
// answer it: a failed turn writes no usage, so it is invisible to every Turn
// the Stop hook reports.
//
// This hook sends the failure and nothing else. It does not flush the Turns
// before it: `Stop` does not fire on a failed turn, so those Turns wait for the
// next `Stop` or the `SessionStart` sweep, both of which read from the cursor
// this hook deliberately leaves alone. Reporting them from here would mean
// advancing a cursor on a path the failure case has no reason to touch.
//
// Silent and always exit 0, for the two reasons `stop.mjs` gives: a non-zero
// exit prints a hook error notice on every failed turn, and stderr from a hook
// lands in the transcript this product uploads. The lazy import is the same
// rule as well — `report.mjs` reaches `packages/shared`'s TypeScript, which a
// Node below 22.18 cannot load.
//
// The event carries `error`, optional `error_details` and
// `last_assistant_message`, which on this event alone is the rendered API error
// rather than Claude's output (Claude Code hooks reference, `StopFailure`).
// None of the conversation travels here.

import { hostname } from 'node:os'

import { readConfiguration } from '../src/configuration.mjs'

const readStdin = async () => {
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  return input
}

try {
  const event = JSON.parse(await readStdin())
  const configuration = readConfiguration()

  const { send } = await import('../src/report.mjs')
  const { deviceKey } = await import('../../shared/src/identity.ts')
  // Imported, not a second literal: a message between two spellings of the
  // same limit would be refused at the boundary and, with no retry queue yet,
  // silently lost. Bounded here as well as there so the route refuses nothing
  // this hook could have trimmed.
  const { FAILURE_MESSAGE_LIMIT } = await import('../../shared/src/limits.ts')

  // `error_details` before the rendered line: it is the one that says *what*
  // the deployment answered ("429 Too Many Requests"), where the rendered line
  // repeats the type in prose. Either may be absent, and the type alone is
  // still the ticket's question answered.
  const message = event.error_details ?? event.last_assistant_message ?? null

  await send({
    configuration,
    payload: {
      device: {
        key: deviceKey({ hostname: hostname(), environment: process.env }),
      },
      reports: [],
      failures: [
        {
          sessionId: event.session_id,
          // The hook fires for an Agent Run's failure too, and the event names
          // no agent — so this is the Session's own failure or nothing.
          agentId: null,
          // The event states no time. The Collector's clock is the honest one
          // and, more to the point, a fixed one: it is part of the identity
          // key, so a retry of this exact payload is the same row.
          occurredAt: new Date().toISOString(),
          // Trimmed `||`, not `??`: an empty or whitespace-only `error` is not
          // a type, and the boundary would refuse it (`.min(1).refine`) into
          // the silent catch, losing the failure with no retry queue yet.
          errorType: event.error?.trim() || 'unknown',
          message:
            typeof message === 'string'
              ? message.slice(0, FAILURE_MESSAGE_LIMIT)
              : null,
        },
      ],
    },
  })
} catch {
  // Deliberately silent: see above.
}
