import { Row, SectionBreak } from '../../_ui/primitives'
import { compact, count, usd } from '../../../lib/money'
import { UNKNOWN_MODEL } from '../../../lib/series'
import type { TokenBreakdown, TokenTotals } from '../../../lib/tokens'

// The token table every Costs column opens with (Taha, 2026-09-23): input,
// output, cache read and cache write, each with its cost, then the total; and,
// for every cut but a model's own, the same tokens split by model.
//
// Cache write is one line, the reported creation total: the 5m and 1h splits
// are subsets of it, and three lines would count the same token twice.

export function TokenTable({
  totals,
  models,
}: {
  totals: TokenTotals
  /** The split by model; left out for a model's own column. */
  models?: TokenBreakdown['models']
}) {
  return (
    <>
      <SectionBreak>Tokens</SectionBreak>
      <ol>
        {totals.classes.map((entry) => (
          <li key={entry.key}>
            <Row
              lead="none"
              name={entry.label}
              // Unknown, never zero, when some of these tokens have no Rate.
              value={entry.costUsd === null ? 'unpriced' : usd(entry.costUsd)}
              sub={`${compact.format(entry.tokens)} tokens`}
            />
          </li>
        ))}
        <li className="border-rule mt-1 border-t">
          <Row
            lead="none"
            value={usd(totals.costUsd)}
            sub={`${compact.format(totals.tokens)} tokens${
              totals.unpricedTurns > 0
                ? ` · some usage unpriced, not in the total`
                : ''
            }`}
          >
            <span className="font-semibold">Total</span>
          </Row>
        </li>
      </ol>

      {models && models.length > 0 ? (
        <>
          <SectionBreak>By model</SectionBreak>
          {/* A table, because the point is reading one class down the
              models; at 390px it scrolls sideways rather than wrapping a
              column of numbers into two lines. */}
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full border-collapse text-caption whitespace-nowrap tabular-nums">
              <thead className="text-text-muted">
                <tr className="text-right [&>th]:py-1.5 [&>th]:pl-2 [&>th]:font-normal">
                  <th className="!pl-0 text-left">Model</th>
                  <th>Input</th>
                  <th>Output</th>
                  <th>Cache read</th>
                  <th>Cache write</th>
                  <th>Cost</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {models.map((model) => (
                  <tr
                    key={model.model ?? UNKNOWN_MODEL}
                    className="border-rule border-t text-right [&>td]:py-1.5 [&>td]:pl-2"
                  >
                    <td
                      className={`max-w-32 truncate !pl-0 text-left ${
                        model.model === null ? 'text-text-muted font-sans' : ''
                      }`}
                      title={model.model ?? UNKNOWN_MODEL}
                    >
                      {model.model ?? UNKNOWN_MODEL}
                    </td>
                    {model.classes.map((entry) => (
                      <td key={entry.key}>{compact.format(entry.tokens)}</td>
                    ))}
                    <td className="text-text">{usd(model.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </>
  )
}

/** `3 sessions`. */
export const sessionCount = (sessions: number) =>
  `${count.format(sessions)} ${sessions === 1 ? 'session' : 'sessions'}`
