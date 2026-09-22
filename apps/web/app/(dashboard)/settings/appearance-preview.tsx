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

  return (
    <div className="border-rule mt-4 rounded border p-4">
      <p className="text-text-secondary text-sm">
        The accent in force is <span className="font-mono">{seed}</span>, and
        these are the seven values it resolved to. They are computed once when a
        colour is saved and stored beside it, so no colour library is shipped to
        the browser and nothing is recomputed per page.
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {swatches.map((one) => (
          <div key={one.token} className="flex items-center gap-2">
            <span
              // A swatch is decoration; the hex beside it is the information,
              // so this is hidden rather than described twice.
              aria-hidden="true"
              className="border-rule-strong h-8 w-8 shrink-0 rounded border"
              style={one.style}
            />
            <div className="min-w-0">
              <dt className="text-text text-caption">{one.label}</dt>
              <dd className="text-text-muted font-mono text-micro">
                {one.value}
              </dd>
            </div>
          </div>
        ))}
      </dl>
      <p className="text-text-muted mt-3 text-caption">
        Every accent fill carries its border: tone 60 measures about 3.0 against
        the page across the presets, which is the 3:1 minimum with nothing to
        spare, so the fill never carries its own boundary.
      </p>
    </div>
  )
}
