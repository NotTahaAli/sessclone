// Ticket 77's OrgMark, from `docs/design/design-system.md` § Components: the
// uploaded logo, or the Org's initial on `--color-quiet-bg`, at 20px in the
// nav, 32px on sign-in and 24px in an email.
//
// Never recoloured, cropped or stretched, and on its own tile so a dark logo
// survives the dark theme — which is the whole of the design note, and the
// reason the image sits in a padded square rather than being drawn edge to
// edge.

export type MarkSize = 20 | 24 | 32

/** The three sizes, with their styles built once rather than per render. */
const TILE: Record<MarkSize, { width: number; height: number }> = {
  20: { width: 20, height: 20 },
  24: { width: 24, height: 24 },
  32: { width: 32, height: 32 },
}

const GLYPH: Record<MarkSize, { fontSize: number }> = {
  20: { fontSize: 10 },
  24: { fontSize: 12 },
  32: { fontSize: 16 },
}

// A grapheme, not a code unit: an Org whose name starts with an emoji or a
// Devanagari cluster would otherwise get half of one.
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** The initial, for an Org with no logo. Not the whole name: the tile is 20px
 * in the nav, where two letters are a smudge. */
const initial = (name: string) =>
  [...graphemes.segment(name.trim())][0]?.segment.toUpperCase() ?? '?'

export function OrgMark({
  name,
  src,
  size = 20,
}: {
  name: string
  /** The logo URL, or nothing — an Org that has not uploaded one. */
  src?: string | null
  size?: MarkSize
}) {
  return (
    <span
      className="bg-quiet-bg border-quiet-border inline-flex shrink-0 items-center justify-center overflow-hidden rounded-sm border align-middle"
      style={TILE[size]}
      aria-hidden
    >
      {src ? (
        // `object-contain`, so a wide logo is letterboxed rather than cropped
        // to a square it was never drawn for. The alt is empty and the tile is
        // `aria-hidden` on purpose: the Org's name is always rendered beside
        // it, and a screen reader announcing it twice is worse than not at all.
        // `next/image` is the wrong tool here and the rule cannot know it:
        // this is a 20-to-32px mark served by our own route with an immutable
        // ETag, already bounded at 256 kB, and routing it through the image
        // optimiser would add a second cache in front of a picture that is
        // smaller than the request for it.
        // oxlint-disable-next-line next/no-img-element
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          className="h-full w-full object-contain"
        />
      ) : (
        <span
          className="text-quiet-text font-mono leading-none"
          style={GLYPH[size]}
        >
          {initial(name)}
        </span>
      )}
    </span>
  )
}
