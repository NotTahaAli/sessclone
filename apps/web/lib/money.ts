// Money, at the two scales this product shows it at.
//
// Every surface until now totalled a period, where two decimal places are
// right and a third is noise. Tickets 86 and 88 show one Turn, where two
// decimal places round almost every figure to `$0.00` — a Turn costing three
// hundredths of a cent is the common case, and a column of `$0.00` beside real
// token counts reads as "this was free", which is exactly the confident wrong
// number ADR 0002 is about.
//
// So one function, and it picks the scale from the value rather than from the
// caller: anything that would round to nothing at two decimals is shown at
// six. Rates have the same spread — output is $75.00 per MTok and a cache read
// is $0.025 — so they go through the same function.

const CENTS = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
})

const MICRO = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 6,
  maximumFractionDigits: 6,
})

/**
 * A dollar figure, or an em dash when it is unknown.
 *
 * Null is unknown and is never rendered as zero: a Turn with no Rate for
 * something it consumed has a cost nobody knows, and `$0.00` is a claim.
 * Genuine zero — a class the Turn consumed nothing of — is `$0.00`, which is
 * true.
 */
export const usd = (value: number | null): string => {
  if (value === null) return '—'
  if (value === 0) return CENTS.format(0)
  return Math.abs(value) < 0.005 ? MICRO.format(value) : CENTS.format(value)
}

/** Token counts and request counts, in full: these are quantities, not sizes. */
export const count = new Intl.NumberFormat('en-US')

/** Large token totals where the exact digit does not matter. */
export const compact = new Intl.NumberFormat('en-US', { notation: 'compact' })
