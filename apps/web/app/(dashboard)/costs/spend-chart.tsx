import type { Day, Series, SpendSeries } from '../../../lib/series'

// Ticket 52's chart. Stacked bars, one per day, split by model.
//
// `docs/design/dashboard-wireframes.md` chose the shape and said why: a line
// implies a continuous quantity and spend is a sum over a bucket, so bars; and
// stacking keeps the total readable while the split stays visible.
//
// It is an SVG rendered on the server, with no client module behind it. The
// data is known at request time and the chart does not animate, so shipping a
// charting library to draw 31 rectangles would be paying a bundle for nothing.
// What that costs is the hover readout the design system's ChartFrame lists —
// each bar carries a `<title>`, which a pointer shows and a touch device does
// not. The table below the plot is what carries the numbers on a phone, and
// it is the same table a screen reader reads.

/**
 * The plot, in user units.
 *
 * The SVG holds rectangles and nothing else, and is stretched to its box
 * rather than scaled uniformly: at 390px a chart that kept a 3:1 ratio came
 * out 110px tall, which is a strip rather than a chart. Text is the reason
 * that is usually a bad trade, so the text is outside — the two money labels
 * and the two dates are HTML beside the plot, and only the bars stretch. The
 * hatch angle shifts with the box, which is the whole cost.
 */
const WIDTH = 600
const HEIGHT = 200

/**
 * The hatched cap for unpriced Turns, at a fixed height and detached from the
 * money axis by a gap.
 *
 * The design system is explicit that this is not drawn to scale: the cost is
 * unknown, so any height on the money axis would be a claim about it. A fixed
 * mark says "there is usage here we cannot price" and nothing more.
 */
const CAP = { height: 8, gap: 4 }

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
})
const compactMoney = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 2,
})
const tokens = new Intl.NumberFormat('en-US', { notation: 'compact' })
const whole = new Intl.NumberFormat('en-US')

/** `2026-09-04` as `4 Sep`. The bars are dense, so the year is in the header. */
const shortDate = (date: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`))

const fill = (slot: Series['slot']) => `var(--color-series-${slot})`

export function SpendChart({ series }: { series: SpendSeries }) {
  const { days } = series
  const peak = Math.max(...days.map((day) => day.costUsd), 0)
  // The cap sits above the tallest bar rather than overlapping it, so the
  // money axis keeps the room it needs even on the busiest day. With nothing
  // unpriced no cap is drawn, and reserving its room anyway would float the
  // top axis label a few percent above the bar it labels.
  const headroom = series.unpricedTurns > 0 ? CAP.height + CAP.gap : 0
  const scale = peak > 0 ? (HEIGHT - headroom) / peak : 0
  const step = WIDTH / days.length
  // A day is a column with a hairline of air either side, and never narrower
  // than a line: a year of days at 600 units is under two units each.
  const barWidth = Math.max(step - 1, 1)

  return (
    <figure className="flex flex-col gap-3">
      <Legend series={series} />

      <div className="flex gap-2">
        {/* The money axis: the two values that bound it, because a grid of
            five ticks on a bar chart is furniture. */}
        <div className="text-text-muted flex flex-col justify-between font-mono text-micro">
          <span>{compactMoney.format(peak)}</span>
          <span>{compactMoney.format(0)}</span>
        </div>

        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          className="border-rule h-44 w-full border-b sm:h-56"
          role="img"
          aria-label={`Spend per day, ${shortDate(days[0]!.date)} to ${shortDate(
            days.at(-1)!.date,
          )}, ${money.format(series.costUsd)} in total`}
        >
          <defs>
            {/* A stripe of the ground at full opacity over the neutral, which
                keeps the cap's contrast at least as good as the neutral's own
                wherever it is drawn. */}
            <pattern
              id="unpriced-hatch"
              width={8}
              height={8}
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <rect
                width={8}
                height={8}
                fill="var(--color-series-other)"
                stroke="none"
              />
              <rect
                width={4}
                height={8}
                fill="var(--color-ground)"
                stroke="none"
              />
            </pattern>
          </defs>

          {days.map((day, index) => (
            <Bar
              key={day.date}
              day={day}
              x={index * step}
              width={barWidth}
              baseline={HEIGHT}
              scale={scale}
            />
          ))}
        </svg>
      </div>

      <div className="text-text-muted flex justify-between font-mono text-micro">
        <span>{shortDate(days[0]!.date)}</span>
        <span>{shortDate(days.at(-1)!.date)}</span>
      </div>

      <figcaption className="text-text-muted text-caption">
        Cost is an estimate, derived from the usage reported and the published
        prices. Days are the Org&apos;s own.
      </figcaption>

      <DayTable days={days} />
    </figure>
  )
}

function Bar({
  day,
  x,
  width,
  baseline,
  scale,
}: {
  day: Day
  x: number
  width: number
  baseline: number
  scale: number
}) {
  // Drawn from the baseline up, so the largest series sits at the bottom of
  // the stack and the reader compares the same colour against the same edge.
  // The running offset is resolved before the JSX rather than inside it: a
  // variable a render mutates while it renders is the one shape React cannot
  // promise to run once.
  const blocks: { slot: Series['slot']; y: number; height: number }[] = []
  let top = baseline
  for (const segment of day.segments) {
    const height = segment.costUsd * scale
    top -= height
    blocks.push({ slot: segment.slot, y: top, height })
  }

  return (
    <g>
      <title>
        {`${shortDate(day.date)}: ${money.format(day.costUsd)}, ${whole.format(
          day.turns,
        )} turns, ${tokens.format(day.tokens)} tokens${
          day.unpricedTurns > 0
            ? `, ${whole.format(day.unpricedTurns)} unpriced`
            : ''
        }`}
      </title>
      {blocks.map((block) => (
        <rect
          key={block.slot}
          x={x}
          y={block.y}
          width={width}
          height={block.height}
          fill={fill(block.slot)}
        />
      ))}
      {day.unpricedTurns > 0 ? (
        <rect
          x={x}
          y={top - CAP.gap - CAP.height}
          width={width}
          height={CAP.height}
          fill="url(#unpriced-hatch)"
        />
      ) : null}
    </g>
  )
}

function Legend({ series }: { series: SpendSeries }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {series.series.map((entry) => (
        <li key={entry.label} className="flex items-center gap-2">
          <Swatch fill={fill(entry.slot)} />
          <span className="text-caption">{entry.label}</span>
          <span className="text-text-muted font-mono text-caption">
            {money.format(entry.costUsd)}
          </span>
        </li>
      ))}
      {series.unpricedTurns > 0 ? (
        <li className="flex items-center gap-2">
          <Swatch fill="url(#unpriced-hatch-swatch)" hatch />
          <span className="text-caption">Unpriced</span>
          <span className="text-text-muted font-mono text-caption">
            {whole.format(series.unpricedTurns)} turns
          </span>
        </li>
      ) : null}
    </ul>
  )
}

/**
 * One legend swatch.
 *
 * An SVG rather than a `div`, because the colour is a token read through
 * `var()` and a Tailwind class cannot be built from a value — and because the
 * unpriced swatch is the same hatch the chart draws, carried by the same
 * pattern rather than approximated in CSS.
 *
 * Colour is the second channel and the label beside it is the first, so a
 * reader who cannot tell two swatches apart still reads the chart.
 */
function Swatch({ fill: paint, hatch }: { fill: string; hatch?: boolean }) {
  return (
    <svg width={12} height={12} aria-hidden="true" className="shrink-0">
      {hatch ? (
        <defs>
          <pattern
            id="unpriced-hatch-swatch"
            width={8}
            height={8}
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect
              width={8}
              height={8}
              fill="var(--color-series-other)"
              stroke="none"
            />
            <rect
              width={4}
              height={8}
              fill="var(--color-ground)"
              stroke="none"
            />
          </pattern>
        </defs>
      ) : null}
      <rect width={12} height={12} rx={2} fill={paint} />
    </svg>
  )
}

/**
 * The same days as rows.
 *
 * Not a fallback: the wireframes put the chart and the numbers on the same
 * screen at both widths, and this is how a phone reader and a screen reader
 * get the values the pointer gets from a tooltip. Days with nothing in them
 * are left out here — the chart already shows the gap, and thirty empty rows
 * would bury the days that have something in them.
 */
function DayTable({ days }: { days: Day[] }) {
  const used = days.filter((day) => day.turns > 0)
  if (used.length === 0) return null

  return (
    <table className="w-full text-caption">
      <caption className="sr-only">Spend per day</caption>
      <thead className="text-label text-text-muted uppercase">
        <tr>
          <th scope="col" className="py-1 text-left font-medium">
            Day
          </th>
          <th scope="col" className="py-1 text-right font-medium">
            Cost
          </th>
          <th scope="col" className="py-1 text-right font-medium">
            Tokens
          </th>
          <th scope="col" className="py-1 text-right font-medium">
            Turns
          </th>
        </tr>
      </thead>
      <tbody className="font-mono">
        {used.map((day) => (
          <tr key={day.date} className="border-rule border-t">
            <th scope="row" className="py-1 text-left font-normal">
              {shortDate(day.date)}
            </th>
            {/* A day whose every Turn is unpriced is unknown, not zero. */}
            <td className="py-1 text-right">
              {day.unpricedTurns === day.turns
                ? '—'
                : money.format(day.costUsd)}
            </td>
            <td className="text-text-secondary py-1 text-right">
              {tokens.format(day.tokens)}
            </td>
            <td className="text-text-secondary py-1 text-right">
              {whole.format(day.turns)}
              {day.unpricedTurns > 0 ? (
                <span className="text-text-muted">
                  {' '}
                  ({whole.format(day.unpricedTurns)} unpriced)
                </span>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
