import { describe, expect, it } from 'vitest'

import {
  accentProperties,
  CHROMA_FLOOR,
  CLAY,
  CLAY_SEED,
  PRESETS,
  readSeed,
  resolveAccent,
} from '../lib/accent'

// Ticket 77. The table in `docs/design/design-system.md` § "The six presets,
// resolved" is real output from material-color-utilities 0.4.0, measured for
// contrast against both grounds and quoted in `globals.css` for Clay. This
// file is that table, asserted — so a change to the library, to the tones each
// token reads, or to the call itself is a failing test rather than a product
// whose accents quietly stopped matching the ratios somebody measured.
const MEASURED = [
  {
    name: 'Clay',
    seed: '#D97757',
    fill: '#DA7453',
    onFill: '#390B00',
    textLight: '#9B4427',
    textDark: '#FFB59E',
    border: '#BA5C3D',
    subtleLight: '#FFEDE8',
    subtleDark: '#5D1800',
  },
  {
    name: 'Blue',
    seed: '#6A9BCC',
    fill: '#4A96D8',
    onFill: '#001D34',
    textLight: '#00629E',
    textDark: '#99CBFF',
    border: '#287CBC',
    subtleLight: '#E8F1FF',
    subtleDark: '#003355',
  },
  {
    name: 'Olive',
    seed: '#788C5D',
    fill: '#759C42',
    onFill: '#102000',
    textLight: '#456813',
    textDark: '#A9D472',
    border: '#5C822B',
    subtleLight: '#D3FF99',
    subtleDark: '#1F3700',
  },
  {
    name: 'Aqua',
    seed: '#2E9191',
    fill: '#00A1A1',
    onFill: '#002020',
    textLight: '#006A6A',
    textDark: '#4CDADA',
    border: '#008585',
    subtleLight: '#ADFFFE',
    subtleDark: '#003737',
  },
  {
    name: 'Violet',
    seed: '#6B4D9E',
    fill: '#A181D8',
    onFill: '#270058',
    textLight: '#6D4EA1',
    textDark: '#D5BBFF',
    border: '#8667BC',
    subtleLight: '#F7EDFF',
    subtleDark: '#3D1C70',
  },
  {
    name: 'Fig',
    seed: '#C46686',
    fill: '#D57193',
    onFill: '#3E001D',
    textLight: '#984061',
    textDark: '#FFB1C8',
    border: '#B75879',
    subtleLight: '#FFECEF',
    subtleDark: '#5E1132',
  },
]

describe('resolveAccent', () => {
  it.each(MEASURED)('matches the measured table for $name', (preset) => {
    const { name: _name, seed, ...tones } = preset
    expect(resolveAccent(seed)).toEqual(tones)
  })

  it('resolves the worst out-of-sample seed the design system found', () => {
    // A fully saturated yellow, which the design system keeps in its table
    // because it breaks the 3:1 bound the fill is measured against. It is
    // still a seed somebody can type, and it must resolve rather than throw.
    expect(resolveAccent('#FFFF00')).toEqual({
      fill: '#969600',
      onFill: '#1D1D00',
      textLight: '#626200',
      textDark: '#CDCD00',
      border: '#7B7B00',
      subtleLight: '#F9F900',
      subtleDark: '#323200',
    })
  })

  it('agrees with what globals.css declares for Clay', () => {
    // The stylesheet carries Clay's resolved values as literals, because a
    // signed-out visitor gets them with nothing rendered from the database.
    // Two copies of seven hex values is two copies too many to leave
    // unchecked.
    expect(CLAY).toEqual(resolveAccent(CLAY_SEED))
    expect(accentProperties(CLAY)).toEqual({
      '--accent-fill': '#DA7453',
      '--accent-on-fill': '#390B00',
      '--accent-border': '#BA5C3D',
      '--accent-text-light': '#9B4427',
      '--accent-text-dark': '#FFB59E',
      '--accent-subtle-light': '#FFEDE8',
      '--accent-subtle-dark': '#5D1800',
    })
  })

  it('offers the six presets the design system measured', () => {
    expect(PRESETS.map((preset) => preset.seed)).toEqual(
      MEASURED.map((preset) => preset.seed),
    )
  })
})

describe('readSeed', () => {
  it('canonicalises what somebody typed', () => {
    // One colour, four spellings: the stored value decides which swatch reads
    // as selected, so it cannot depend on how it was typed.
    for (const typed of ['#D97757', '#d97757', 'D97757', '  #d97757 ']) {
      expect(readSeed(typed)).toEqual({ seed: '#D97757' })
    }
  })

  it('expands three-digit shorthand', () => {
    expect(readSeed('#f0a')).toEqual({ seed: '#FF00AA' })
  })

  it('refuses anything that is not a hex colour', () => {
    for (const typed of ['', 'red', '#12345', '#1234567', 'rgb(1,2,3)']) {
      expect(readSeed(typed)).toEqual({ refusal: 'not_a_hex' })
    }
  })

  it('refuses a near-neutral seed rather than saturating it', () => {
    // The design system's own measurement: `#808080` has chroma 1.9 and comes
    // back from the palette as a cyan at chroma 44.9. Accepting it would give
    // somebody an accent they did not choose and could not predict.
    expect(readSeed('#808080')).toEqual({ refusal: 'too_neutral' })
    expect(readSeed('#FFFFFF')).toEqual({ refusal: 'too_neutral' })
    expect(readSeed('#000000')).toEqual({ refusal: 'too_neutral' })
  })

  it('accepts every preset, and the floor is under all of them', () => {
    for (const preset of PRESETS) {
      expect(readSeed(preset.seed)).toEqual({ seed: preset.seed })
    }
    expect(CHROMA_FLOOR).toBeGreaterThan(1.9)
  })
})
