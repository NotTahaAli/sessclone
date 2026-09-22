import {
  argbFromHex,
  CorePalette,
  Hct,
  hexFromArgb,
} from '@material/material-color-utilities'

import { type AccentTones, CLAY_SEED } from './accent-presets'

// Ticket 77: one seed colour in, the derived half of the token system out.
//
// `docs/design/design-system.md` § "Colour — accent, derived from a seed"
// decides every number here, including which tone each token reads and why
// two of them differ by theme. The exact call it specifies is
// `CorePalette.of(argbFromHex(seed)).a1.tone(n)`, one call per tone, and
// `accent.test.ts` asserts the output against the six presets it measured.
//
// **This module never reaches the browser**, and the names a browser does need
// — the preset list, the tone type, the property names — live in
// `accent-presets.ts` so that importing one of them cannot drag the library
// along. A client component importing from *this* file ships 86 kB of colour
// science, because resolving Clay below is a top-level side effect and
// tree-shaking gives up on those. The tones are resolved when a
// seed is saved and stored beside it, which is the ticket's own criterion:
// the colour library is 60 kB of colour science, and a live preview that
// imported it would ship all of it to every visitor to recompute a value the
// database already holds.

export type { AccentTones } from './accent-presets'
export { accentProperties, CLAY_SEED, PRESETS } from './accent-presets'

/** The tones the design system reads off `a1`, per token. */
const TONES = {
  fill: 60,
  onFill: 10,
  border: 50,
  textLight: 40,
  textDark: 80,
  subtleLight: 95,
  subtleDark: 20,
} as const

/** Six digits with a leading `#`. Three-digit shorthand is expanded first. */
const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

/**
 * The chroma a seed needs before the palette can hold it.
 *
 * `CorePalette.of()` puts a floor under primary chroma, so the ramp it returns
 * for a near-neutral seed is never the grey that was typed: the design system
 * measured `#808080` (chroma 1.9) coming back as a cyan at chroma 44.9. Which
 * means a Member who types a grey gets an accent they did not choose and
 * cannot predict — so it is refused with a reason rather than accepted and
 * silently replaced.
 */
export const CHROMA_FLOOR = 16

export type SeedRefusal = 'not_a_hex' | 'too_neutral'

/**
 * The canonical form of a typed seed, or why it cannot be one.
 *
 * Canonicalised rather than stored as typed: `#d97757`, `D97757` and `#D97757`
 * are one colour, and a stored seed is compared against the presets to decide
 * which swatch is selected.
 */
export const readSeed = (
  typed: string,
): { seed: string } | { refusal: SeedRefusal } => {
  const match = HEX.exec(typed.trim())
  if (!match) return { refusal: 'not_a_hex' }

  const digits = match[1]!
  // `replace` rather than spreading the string: these are hex digits, but a
  // spread of a string yields code points and the lint rule is right that it
  // is the wrong tool on text in general.
  const full =
    digits.length === 3 ? digits.replaceAll(/./g, (one) => one + one) : digits

  const seed = `#${full.toUpperCase()}`
  // Measured on the seed itself, not on the ramp: the ramp is never neutral,
  // which is the whole reason this check exists.
  if (Hct.fromInt(argbFromHex(seed)).chroma < CHROMA_FLOOR) {
    return { refusal: 'too_neutral' }
  }

  return { seed }
}

/** What to tell somebody whose seed was refused. */
export const SEED_REFUSALS: Record<SeedRefusal, string> = {
  not_a_hex: 'A seed is a hex colour, like #D97757.',
  too_neutral:
    'That colour is too close to grey for the palette to hold: it would come ' +
    'back as a saturated accent you did not choose. Pick something with more ' +
    'colour in it.',
}

/**
 * The seven derived values for one seed.
 *
 * Deliberately not memoised. It is called when a seed is saved — once per
 * save, on the server — and a module-level cache keyed by seed would be an
 * unbounded `Map` growing for the life of the process (AGENTS.md § Efficiency)
 * to save a few hundred microseconds on a path nobody is waiting on.
 */
export const resolveAccent = (seed: string): AccentTones => {
  const palette = CorePalette.of(argbFromHex(seed)).a1
  const tone = (which: number) => hexFromArgb(palette.tone(which)).toUpperCase()
  // Written out rather than mapped into an object: `Object.fromEntries` returns
  // a record of strings that only an assertion could narrow to this type, and
  // an assertion is how a token added to `TONES` and forgotten here would
  // typecheck.
  return {
    fill: tone(TONES.fill),
    onFill: tone(TONES.onFill),
    border: tone(TONES.border),
    textLight: tone(TONES.textLight),
    textDark: tone(TONES.textDark),
    subtleLight: tone(TONES.subtleLight),
    subtleDark: tone(TONES.subtleDark),
  }
}

/** Clay, resolved — the default accent, and what `globals.css` declares. */
export const CLAY: AccentTones = resolveAccent(CLAY_SEED)
