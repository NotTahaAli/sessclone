import type postgres from 'postgres'

// Ticket 77's logo half. Two things live here: what counts as a logo, and the
// four statements that store one.
//
// The format and the dimensions are read out of the bytes rather than taken
// from the multipart part's own `Content-Type`, which is a string the client
// chose. A `.png` that is really an HTML document would otherwise reach a
// route that serves it from this origin with the type it claimed.

/** The outside bound on what gets stored, matched by `org_logos_size_check`. */
export const MAX_LOGO_BYTES = 262_144

/**
 * The smallest useful logo. The mark is drawn at 32px on sign-in on a 2x
 * screen, so anything under 64 is already being upscaled — and the design
 * system's FileDrop has a "too small" state precisely so that is said rather
 * than silently accepted.
 */
export const MIN_LOGO_PIXELS = 64

export type LogoRefusal = 'not_an_image' | 'too_small' | 'too_large'

export type Logo = {
  contentType: 'image/png' | 'image/jpeg' | 'image/webp'
  width: number
  height: number
}

export const LOGO_REFUSALS: Record<LogoRefusal, string> = {
  not_an_image: 'A logo is a PNG, a JPEG or a WebP image.',
  too_small: `That image is under ${MIN_LOGO_PIXELS}px on one side, which would be upscaled wherever it appears.`,
  too_large: `That file is over ${Math.round(MAX_LOGO_BYTES / 1024)} kB. A logo this size is a logo somebody waits for.`,
}

const startsWith = (bytes: Uint8Array, signature: number[], at = 0) =>
  signature.every((byte, index) => bytes[at + index] === byte)

const png = (bytes: Uint8Array): Logo | null => {
  if (!startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return null
  }
  // IHDR is required to be the first chunk, so the two dimensions are at fixed
  // offsets: 8 bytes of signature, 8 of chunk header, then two big-endian 32s.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.byteLength < 24) return null
  return {
    contentType: 'image/png',
    width: view.getUint32(16),
    height: view.getUint32(20),
  }
}

const jpeg = (bytes: Uint8Array): Logo | null => {
  if (!startsWith(bytes, [0xff, 0xd8, 0xff])) return null

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // Walk the segments to the first frame header. The dimensions are not at a
  // fixed offset in a JPEG: EXIF, ICC profiles and comments all sit in front
  // of it, and how many is up to whatever wrote the file.
  let at = 2
  while (at + 9 < bytes.byteLength) {
    if (bytes[at] !== 0xff) return null
    const marker = bytes[at + 1]!
    // Any SOFn — baseline, progressive, lossless — carries the size in the
    // same place. DHT (c4), DNL (c8) and DAC (cc) share the range and do not.
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker)
    ) {
      return {
        contentType: 'image/jpeg',
        height: view.getUint16(at + 5),
        width: view.getUint16(at + 7),
      }
    }
    at += 2 + view.getUint16(at + 2)
  }
  return null
}

const found = (width: number, height: number): Logo => ({
  contentType: 'image/webp',
  width,
  height,
})

const webp = (bytes: Uint8Array): Logo | null => {
  // 'RIFF' … 'WEBP', then one chunk naming the codec, each of which stores the
  // canvas differently.
  if (!startsWith(bytes, [0x52, 0x49, 0x46, 0x46])) return null
  if (!startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return null
  if (bytes.byteLength < 30) return null

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const chunk = String.fromCharCode(...bytes.slice(12, 16))

  // Lossy: a VP8 keyframe header, 14 bits of each dimension after a 3-byte
  // start code and a 2-byte sync.
  if (chunk === 'VP8 ') {
    return found(
      view.getUint16(26, true) & 0x3fff,
      view.getUint16(28, true) & 0x3fff,
    )
  }
  // Lossless: 14 bits each, minus one, packed little-endian from bit 0 of the
  // byte after the signature.
  if (chunk === 'VP8L') {
    const packed = view.getUint32(21, true)
    return found((packed & 0x3fff) + 1, ((packed >> 14) & 0x3fff) + 1)
  }
  // Extended: an explicit canvas, three bytes each, minus one.
  if (chunk === 'VP8X') {
    const at = (offset: number) =>
      (view.getUint16(offset, true) | (bytes[offset + 2]! << 16)) + 1
    return found(at(24), at(27))
  }
  return null
}

/**
 * What these bytes are, or why they are not a logo.
 *
 * Order matters only for the size check, which comes first: parsing the header
 * of a 40 MB file to then refuse it for its length is work nobody asked for.
 */
export const readLogo = (
  bytes: Uint8Array,
): { logo: Logo } | { refusal: LogoRefusal } => {
  if (bytes.byteLength === 0) return { refusal: 'not_an_image' }
  if (bytes.byteLength > MAX_LOGO_BYTES) return { refusal: 'too_large' }

  const logo = png(bytes) ?? jpeg(bytes) ?? webp(bytes)
  if (!logo) return { refusal: 'not_an_image' }
  if (logo.width < 1 || logo.height < 1) return { refusal: 'not_an_image' }
  if (logo.width < MIN_LOGO_PIXELS || logo.height < MIN_LOGO_PIXELS) {
    return { refusal: 'too_small' }
  }
  return { logo }
}

type LogoRow = {
  bytes: Uint8Array
  content_type: string
  width: number
  height: number
  updated_at: Date
}

/**
 * The stored logo, bytes and all. Read anonymously by the route that serves it
 * (`org_logos_read`), which is why nothing here filters on a viewer.
 */
export const orgLogo = async (tx: postgres.TransactionSql, orgId: string) => {
  const [row] = await tx<LogoRow[]>`
    select bytes, content_type, width, height, updated_at
      from org_logos
     where org_id = ${orgId}
  `
  return row ?? null
}

/** Whether an Org has one, without moving the bytes to ask. */
export const orgLogoVersion = async (
  tx: postgres.TransactionSql,
  orgId: string,
) => {
  const [row] = await tx<{ updated_at: Date }[]>`
    select updated_at from org_logos where org_id = ${orgId}
  `
  return row?.updated_at ?? null
}

/** Postgres' own code for a row an insert policy refused. */
const INSUFFICIENT_PRIVILEGE = '42501'

/**
 * Stores a logo, replacing whatever was there.
 *
 * Returns false when the policies refused, which is what a Member or a Manager
 * gets. An insert is the one verb where a refusal *raises* rather than writing
 * nothing — `with check` is a constraint, not a filter — so this is where that
 * asymmetry is absorbed, and the caller gets the same false a refused update
 * or delete gives it.
 */
export const setOrgLogo = async (
  tx: postgres.TransactionSql,
  orgId: string,
  logo: Logo & { bytes: Uint8Array },
) => {
  // A savepoint, because a raised error otherwise poisons the whole
  // transaction and the action could not go on to render its refusal.
  return tx
    .savepoint((inner) => writeLogo(inner, orgId, logo))
    .catch((error: unknown) => {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === INSUFFICIENT_PRIVILEGE
      ) {
        return false
      }
      throw error
    })
}

const writeLogo = async (
  tx: postgres.TransactionSql,
  orgId: string,
  logo: Logo & { bytes: Uint8Array },
) => {
  const written = await tx`
    insert into org_logos (org_id, bytes, content_type, width, height)
    values (${orgId}, ${logo.bytes}, ${logo.contentType}, ${logo.width},
            ${logo.height})
        on conflict (org_id) do update
       set bytes = excluded.bytes,
           content_type = excluded.content_type,
           width = excluded.width,
           height = excluded.height,
           updated_at = now()
  `
  return written.count > 0
}

/** Removes it, or reports that the caller may not. */
export const clearOrgLogo = async (
  tx: postgres.TransactionSql,
  orgId: string,
) => {
  const written = await tx`delete from org_logos where org_id = ${orgId}`
  return written.count > 0
}

/** Where the browser and a mail client fetch it. Absolute is the caller's job:
 * an email needs an origin, the nav does not. */
export const logoPath = (orgId: string, version: Date) =>
  `/api/org-logo/${orgId}?v=${version.getTime()}`

/**
 * The URL to draw, or null for an Org with no logo.
 *
 * The version is what makes the route's answer cacheable forever: replacing a
 * logo changes the URL, so no browser and no mail client is ever holding the
 * old one at the new address.
 */
export const orgLogoSrc = async (
  tx: postgres.TransactionSql,
  orgId: string,
) => {
  const version = await orgLogoVersion(tx, orgId)
  return version ? logoPath(orgId, version) : null
}
