import { Field } from '../../_ui/primitives'
import type { AccentTones } from '../../../lib/accent-presets'

// Ticket 77, third criterion: the derived values are computed once on save and
// stored. This is what that buys — the seven resolved values, shown as they are
// stored, rendered on the server from the row.
//
// It is also the answer to "what will my seed become". `CorePalette.of()` puts
// a floor under primary chroma, so the palette a seed produces is not the seed:
// a muted olive comes back brighter than it went in, and the design system
// measured `#808080` coming back as a cyan. Showing the resolved tones rather
// than the typed hex is therefore the only honest preview, and it is why the
// picker does not draw one before saving.

/** The tones in the order the design system's table lists them, each with
 * what it paints — a reader is choosing a colour and deserves to know which
 * part of the page each value is. */
const SHOWN: { token: keyof AccentTones; label: string; about: string }[] = [
  { token: 'fill', label: 'Fill', about: 'Buttons, the active nav underline' },
  { token: 'onFill', label: 'On fill', about: 'Text on a filled button' },
  { token: 'border', label: 'Border', about: 'The edge on every accent fill' },
  {
    token: 'textLight',
    label: 'Text (light)',
    about: 'Links in the light theme',
  },
  { token: 'textDark', label: 'Text (dark)', about: 'Links in the dark theme' },
  { token: 'subtleLight', label: 'Subtle (light)', about: 'The quiet panel' },
  { token: 'subtleDark', label: 'Subtle (dark)', about: 'The quiet panel' },
]

export function AccentPreview({
  seed,
  tones,
}: {
  seed: string
  tones: AccentTones
}) {
  // The swatch colours come from the row, so their style objects cannot be
  // module constants — built once here instead of once per element inside the
  // map, which is what the lint rule is asking for.
  const swatches = SHOWN.map((one) => ({
    ...one,
    value: tones[one.token],
    style: { backgroundColor: tones[one.token] },
  }))

  // Ticket 113: one settings row, not a panel — the seed in force on the
  // right with the seven values it resolved to beside it, each named on
  // hover and for a screen reader.
  return (
    <Field
      label="Resolves to"
      hint="Computed once when a colour is saved and stored beside it, so no colour library reaches the browser. Every accent fill carries its border: tone 60 measures about 3:1 against the page."
    >
      <span className="flex items-center gap-2">
        <span className="text-text-muted font-mono text-caption">{seed}</span>
        <span role="list" aria-label="Resolved tones" className="flex gap-1">
          {swatches.map((one) => (
            <span
              key={one.token}
              role="listitem"
              title={`${one.label}: ${one.value} — ${one.about}`}
              className="border-rule-strong block size-3.5 rounded-full border"
              style={one.style}
            >
              <span className="sr-only">
                {one.label} {one.value}
              </span>
            </span>
          ))}
        </span>
      </span>
    </Field>
  )
}
