import type postgres from 'postgres'

import { type AccentTones, CLAY, CLAY_SEED } from './accent'

// Ticket 77: which accent and which theme a person actually gets, and how that
// reaches the document before the first paint.
//
// Two stores, and they answer different questions. The database is the record:
// an Org's default seed and its lock, a Member's own seed and mode, resolved
// tones beside each seed. A cookie is the *delivery*: the theme has to be on
// `<html>` in the first bytes the browser parses or the page paints light and
// then turns dark, and reading the session in the root layout would make every
// route in the product dynamic — including the marketing site, whose whole
// point (ticket 80, 83) is that it is prerendered.
//
// So the cookie is written whenever the record changes and at sign-in, and an
// inline script in `<head>` applies it during parsing. Next's own guidance
// says the same thing in `preventing-flash-before-hydration.md` §
// "Storing the theme in a cookie": reading it in the root layout "opts the
// entire app out of static prerendering (and under Cache Components, forces
// blocking every segment under the layout)".
//
// **The cookie is presentation and never authority.** It carries no id and no
// claim; the worst a tampered one can do is recolour that browser's own pages.
// Every value it holds is checked against a shape before it is applied, in the
// script and here, because the browser is where it has been.

export type Theme = 'light' | 'dark' | 'system'

export type Appearance = {
  /** The seed in force, after the Org's lock and the Member's own choice. */
  seed: string
  tones: AccentTones
  theme: Theme
  /** The Org's default, shown beside a Member's own choice. */
  orgSeed: string
  /** The Org's default, resolved — what Org settings previews. */
  orgTones: AccentTones
  /** Whether the Org has taken the choice: no Member seed applies while set. */
  locked: boolean
  /** The Member's own seed, or null when they inherit the Org's. */
  ownSeed: string | null
}

export const DEFAULT_APPEARANCE: Appearance = {
  seed: CLAY_SEED,
  tones: CLAY,
  theme: 'system',
  orgSeed: CLAY_SEED,
  orgTones: CLAY,
  locked: false,
  ownSeed: null,
}

type AppearanceRow = {
  member_seed: string | null
  member_tones: AccentTones | null
  theme: Theme
  org_seed: string
  org_tones: AccentTones
  accent_locked: boolean
}

/**
 * The appearance in force for the viewer, in one read.
 *
 * A locked Org wins over a Member's stored seed rather than clearing it: a
 * lock is often temporary — a rebrand, a customer demo — and destroying
 * everybody's choice on the way in would mean they all have to choose again
 * when it lifts. So the row keeps the seed and this read ignores it, and the
 * settings page says which is happening.
 */
export const viewerAppearance = async (
  tx: postgres.Sql | postgres.TransactionSql,
): Promise<Appearance> => {
  const [row] = await tx<AppearanceRow[]>`
    select member.accent_seed as member_seed,
           member.accent_tones as member_tones,
           member.theme,
           org.accent_seed as org_seed,
           org.accent_tones as org_tones,
           org.accent_locked
      from members member
      join orgs org on org.id = member.org_id
     where member.id in (select sessclone_own_member_ids())
     -- The same row currentViewer reads, chosen the same way: v1 has one Org
     -- per person, and the ticket that adds a switcher decides which is
     -- current for both.
     order by member.created_at
     limit 1
  `

  if (!row) return DEFAULT_APPEARANCE

  const own = row.member_seed && row.member_tones ? row.member_seed : null
  const inherits = row.accent_locked || !own

  return {
    seed: inherits ? row.org_seed : own,
    tones: inherits ? row.org_tones : row.member_tones!,
    theme: row.theme,
    orgSeed: row.org_seed,
    orgTones: row.org_tones,
    locked: row.accent_locked,
    ownSeed: own,
  }
}

/**
 * Writes a Member's own seed and its resolved tones, or clears both to inherit
 * the Org's.
 *
 * Returns whether a row was written. A refusal is a write that touched nothing
 * — `members_write` plus the trigger beside the column — rather than an error,
 * which is what every other setting on this surface does too.
 */
export const setMemberAccent = async (
  tx: postgres.Sql | postgres.TransactionSql,
  memberId: string,
  accent: { seed: string; tones: AccentTones } | null,
) => {
  const written = await tx`
    update members
       set accent_seed = ${accent?.seed ?? null},
           accent_tones = ${accent ? tx.json(accent.tones) : null}
     where id = ${memberId}
       and id in (select sessclone_own_member_ids())
  `
  return written.count > 0
}

/** Writes a Member's light, dark or system preference. */
export const setMemberTheme = async (
  tx: postgres.Sql | postgres.TransactionSql,
  memberId: string,
  theme: Theme,
) => {
  const written = await tx`
    update members
       set theme = ${theme}
     where id = ${memberId}
       and id in (select sessclone_own_member_ids())
  `
  return written.count > 0
}

/** Writes the Org's default seed, and whether Members may override it. */
export const setOrgAccent = async (
  tx: postgres.Sql | postgres.TransactionSql,
  orgId: string,
  accent: { seed: string; tones: AccentTones },
) => {
  const written = await tx`
    update orgs
       set accent_seed = ${accent.seed},
           accent_tones = ${tx.json(accent.tones)}
     where id = ${orgId}
  `
  return written.count > 0
}

export const setOrgAccentLock = async (
  tx: postgres.Sql | postgres.TransactionSql,
  orgId: string,
  locked: boolean,
) => {
  const written = await tx`
    update orgs set accent_locked = ${locked} where id = ${orgId}
  `
  return written.count > 0
}

/** The cookie the inline script reads. Not `httpOnly`: the script is the
 * reader, and it holds nothing worth protecting from a script that is already
 * running on the page. */
export const APPEARANCE_COOKIE = 'sessclone-appearance'

/** A year. The record is the database's; this is a cache of it. */
export const APPEARANCE_COOKIE_MAX_AGE = 31_536_000

/**
 * How the appearance cookie is written, everywhere it is written — the
 * settings action and the sign-in callback both use this, because two writers
 * disagreeing about `secure` means one sets a cookie the other cannot replace.
 *
 * Presentation, and the script in `<head>` is its only reader, so deliberately
 * not `httpOnly`. `secure` follows the deployment's own URL rather than the
 * request's scheme: behind a TLS-terminating proxy the request arrives as
 * plain HTTP while the browser is on HTTPS, and a self-hoster on plain HTTP
 * behind a VPN would otherwise get a cookie the browser refuses to store and a
 * theme that never applies.
 */
export const APPEARANCE_COOKIE_OPTIONS = {
  path: '/',
  maxAge: APPEARANCE_COOKIE_MAX_AGE,
  sameSite: 'lax',
  secure: (process.env.NEXT_PUBLIC_APP_URL ?? '').startsWith('https://'),
} as const

/**
 * The seven tones, in the fixed order the script reassembles them in, after
 * the theme.
 *
 * Positional rather than JSON: it travels on every request, including every
 * static asset, so the difference between 60 bytes and 200 is paid thousands
 * of times. The order is this constant's, in one place, used by both ends.
 */
const ORDER = [
  'fill',
  'onFill',
  'border',
  'textLight',
  'textDark',
  'subtleLight',
  'subtleDark',
] as const

/** `dark:DA7453,390B00,…` — a theme, then seven six-digit hexes. */
export const encodeAppearance = (appearance: {
  theme: Theme
  tones: AccentTones
}) =>
  `${appearance.theme}:${ORDER.map((token) =>
    appearance.tones[token].replace('#', ''),
  ).join(',')}`

/**
 * The shape the script checks before it touches the document, and the one this
 * module checks before it believes a cookie.
 *
 * Written once here and interpolated into the script, so the two cannot drift.
 * The value reaches `setProperty`, where a custom property's value is not
 * parsed as CSS and so cannot end a rule early — but a cookie is a value the
 * browser has had its hands on, and validating it costs one regular
 * expression.
 */
export const APPEARANCE_PATTERN =
  '^(light|dark|system):([0-9A-Fa-f]{6},){6}[0-9A-Fa-f]{6}$'

export const decodeAppearance = (
  value: string | undefined,
): { theme: Theme; tones: AccentTones } | null => {
  if (!value || !new RegExp(APPEARANCE_PATTERN).test(value)) return null

  const [theme, joined] = value.split(':')
  const hexes = (joined ?? '').split(',').map((hex) => `#${hex.toUpperCase()}`)
  // The pattern above has already decided the shape, so these cannot be
  // missing — but read through an index they are `string | undefined`, and the
  // way to satisfy that honestly is a guard rather than an assertion.
  if (theme !== 'light' && theme !== 'dark' && theme !== 'system') return null
  const [fill, onFill, border, textLight, textDark, subtleLight, subtleDark] =
    hexes
  if (
    !fill ||
    !onFill ||
    !border ||
    !textLight ||
    !textDark ||
    !subtleLight ||
    !subtleDark
  ) {
    return null
  }

  return {
    theme,
    tones: {
      fill,
      onFill,
      border,
      textLight,
      textDark,
      subtleLight,
      subtleDark,
    },
  }
}
