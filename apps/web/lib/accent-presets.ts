// Ticket 77: the parts of the accent system a browser is allowed to have.
//
// Split out of `lib/accent.ts` because that module imports
// `@material/material-color-utilities` **and** resolves Clay at module load,
// so a client component importing one name from it — the preset list, for the
// swatches — pulled 86 kB of CAM16 colour science into the page. The ticket's
// third criterion is that the library never reaches the browser, and a review
// of the built chunks is what caught it: tree-shaking cannot remove a module
// with a top-level side effect.
//
// So: nothing here imports anything, and nothing here computes a colour. The
// resolving lives next door, on the server, where the library is.

/** The seven values written onto the document, per token. */
export type AccentTones = {
  fill: string
  onFill: string
  border: string
  textLight: string
  textDark: string
  subtleLight: string
  subtleDark: string
}

export const CLAY_SEED = '#D97757'

/**
 * The six preset seeds, in the order the design system lists them. A Member or
 * an Org can type any hex; these are the ones with measured contrast ratios
 * behind them, which is why they are what the picker offers first.
 */
export const PRESETS: { name: string; seed: string }[] = [
  { name: 'Clay', seed: CLAY_SEED },
  { name: 'Blue', seed: '#6A9BCC' },
  { name: 'Olive', seed: '#788C5D' },
  { name: 'Aqua', seed: '#2E9191' },
  { name: 'Violet', seed: '#6B4D9E' },
  { name: 'Fig', seed: '#C46686' },
]

/**
 * The custom properties the document carries, as the design system's own
 * example writes them.
 *
 * One map rather than a string, so the caller decides whether it becomes a
 * `style` attribute, a cookie or a line in an inline script — and so the
 * property names exist in exactly one place.
 */
export const accentProperties = (tones: AccentTones) => ({
  '--accent-fill': tones.fill,
  '--accent-on-fill': tones.onFill,
  '--accent-border': tones.border,
  '--accent-text-light': tones.textLight,
  '--accent-text-dark': tones.textDark,
  '--accent-subtle-light': tones.subtleLight,
  '--accent-subtle-dark': tones.subtleDark,
})

/**
 * A typed colour in its canonical form, `#RRGGBB`, or null when it is not a
 * hex at all: with or without the `#`, three digits expanded to six, upper
 * case. `#d97757`, `D97757` and `#D97757` are one colour, and a stored seed is
 * compared against the presets to decide which swatch is selected.
 *
 * The shape only. Whether the palette can hold the colour is `readSeed`'s
 * question, on the server, because answering it needs the colour library —
 * which is why this lives here, in the module with no imports, where the
 * picker in the browser can reach it (ticket 113's custom swatch).
 */
export const canonicalHex = (typed: string): string | null => {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(typed.trim())
  if (!match) return null
  const digits = match[1]!
  // `replace` rather than spreading the string: a spread yields code points,
  // and the lint rule is right that it is the wrong tool on text in general.
  const full =
    digits.length === 3 ? digits.replaceAll(/./g, (one) => one + one) : digits
  return `#${full.toUpperCase()}`
}
