// Ticket 78: what a person can do about a failure, per the wireframe —
// "a sentence saying what to do about it", and for the reader's first worry,
// "plainly whether the costs are affected".
//
// Grounded in the error types ticket 40 actually records, which the spec names
// (`docs/superpowers/specs/2026-09-12-sessclone-design.md` § StopFailure):
// `rate_limit`, `overloaded`, `billing_error`. A type with no advice here is
// not given a generic line pretending to be advice — the surface shows the
// recorded message as recorded instead (that is what `advice: null` means).
//
// Every one of these ends a turn on an API error *before* any usage is written,
// so none of them affects the bill. That is stated rather than assumed, because
// "did this cost me anything" is the first thing the reader wants to know.

export type FailureTone =
  /** Red: the failure lost something or needs a person to act. */
  | 'lost'
  /** Amber: transient, resolves itself on retry. */
  | 'transient'
  /** Neutral: a type we have nothing to say about. */
  | 'neutral'

export type FailureAdvice = {
  tone: FailureTone
  /** The sentence of advice, or null to show the recorded message instead. */
  advice: string | null
  /**
   * Whether the reader's bill is affected — always shown when advice is.
   *
   * Every type below sets this false, because a stop failure ends the turn
   * before any usage is written. It is a field rather than a fixed sentence on
   * purpose: a later type that *does* cost money must not inherit a hardcoded
   * "your cost is unaffected", which is the one claim on this surface that is
   * worse to get wrong than to omit.
   */
  costsAffected: boolean
}

const ADVICE: Record<string, FailureAdvice> = {
  rate_limit: {
    tone: 'transient',
    advice:
      'Claude’s API rate limit was hit and the turn stopped. It usually succeeds on a retry, and no usage was recorded for it.',
    costsAffected: false,
  },
  overloaded: {
    tone: 'transient',
    advice:
      'Claude’s API was briefly overloaded and the turn stopped. It usually succeeds on a retry, and no usage was recorded for it.',
    costsAffected: false,
  },
  billing_error: {
    tone: 'lost',
    advice:
      'Claude’s API refused the turn for a billing reason. Turns will keep failing until the Anthropic account’s billing is resolved. No usage was recorded here.',
    costsAffected: false,
  },
}

/**
 * The advice for one failure type, or a neutral entry with no advice.
 *
 * The lookup is exact and lowercase: the recorded `error_type` is trimmed to
 * at most 64 characters by the ingest schema (ticket 40), and these are the
 * literal strings the collector sends.
 */
export const adviceFor = (errorType: string): FailureAdvice =>
  ADVICE[errorType.toLowerCase()] ?? {
    tone: 'neutral',
    advice: null,
    costsAffected: false,
  }
