# 77: Appearance and branding settings

**What to build:** The settings the design system's derived half assumes exist — an Org's accent seed and its logo, and a Member's own accent and light or dark preference. Ticket 16 defines the tokens these values feed; nothing in the product writes them today.

**Blocked by:** 16, 44, 45, 58.

**Status:** done

- [x] An Owner or Admin sets the Org's default accent seed, and chooses whether Members may override it
- [x] A Member sets their own accent seed and their light, dark, or system preference, unless the Org has locked the seed
- [x] The six derived accent values are computed once on save and stored, so the colour library never reaches the browser bundle
- [x] An Owner or Admin uploads an Org logo, which appears in the signed-in nav, on sign-in, and in invite email, and which a Member cannot remove
- [x] No Role can write another Member's appearance settings, proven as SQL against the policies rather than through the UI
- [x] Theme applies on first paint with no flash, including for a signed-out visitor on the marketing site

The appearance surface is drawn in `docs/design/dashboard-wireframes.md`, under "Two surfaces drawn ahead of their tickets".

## How it shipped

**Theme, without a flash and without losing the static shells.** The design
system said the server writes `data-theme` on `<html>`. It cannot: that element
is in the root layout, so reading the session or a cookie there makes every
route in the product dynamic and, under Cache Components, blocks every segment
beneath it — undoing tickets 80 and 83 for a colour. The resolved theme and the
seven accent properties travel in a cookie instead, applied by an inline script
in `<head>` while the document is parsed. Proved with every JavaScript chunk
blocked: a browser preferring light painted dark, with the accent, at
DOMContentLoaded. `docs/design/design-system.md` now records the deviation.

**A cookie can fall behind the database**, because an Owner changing the Org's
colour writes on their own browser and changes what everybody else sees. The
dashboard shell compares the two on each full load and, when they disagree,
emits a script that applies the right values and rewrites the cookie. A client
component with an effect was the first attempt and is the wrong tool: it cannot
run before the first paint, and it does nothing at all on a page whose
JavaScript has not arrived.

**The logo lives in Postgres, not in object storage**, which is the opposite of
`AGENTS.md` § Efficiency and argued in `20260922130000_org_logo.sql`: two of the
three places it appears have no session to authorise a presigned GET (a mail
client, and the sign-in page somebody reached from an invitation), storage is
optional on a self-hosted deployment, and it is one image of at most 256 kB
served with an ETag. The format and the dimensions are read out of the bytes
rather than believed from the upload, and `image/svg+xml` is refused — an SVG
served from this origin is a document that can carry script.

## Acted on after review

An independent review of the implementation found one blocker and four
should-fixes. Each is fixed with a test, red-verified by reverting the fix.

- **The colour library was in the client bundle**, so the third criterion was
  not met: `seed-picker.tsx` imported the preset list from `lib/accent.ts`,
  whose top-level `resolveAccent(CLAY_SEED)` defeats tree-shaking, and 86 kB of
  CAM16 colour science went to every visitor of the two settings pages. The
  names a browser needs now live in `lib/accent-presets.ts`, which imports
  nothing, and `client-bundle.test.ts` asserts both halves of that in the
  source, since a build is too slow to assert on every run.
- **An oversized image was an error page, not a refusal.** A 10000x10000 flat
  colour compresses to a few kB, so it passed the byte bound and then raised a
  check violation out of the server action. `readLogo` now enforces the same
  8192px bound the table does.
- **A malformed invitation link took the sign-in page down.** `safeNext` says a
  path is safe to return to; it does not say it is well-formed, and
  `?next=/join/%` reached `decodeURIComponent` and threw for a signed-out
  visitor. The token's shape is checked instead, in `lib/auth/next-path.ts`.
- **The friendly "too large" message was unreachable.** Next refuses a Server
  Action body over 1 MB before the action runs, so the common failure — a phone
  photo — produced a framework error rather than the sentence. The size is
  checked in the browser as well.
- **The PNG parser trusted the first chunk to be IHDR** and the JPEG parser
  refused legal `ff` padding between segments. Both fixed, both covered.
- Smaller: `?v=` now has to match the row before the route answers `immutable`,
  `if-none-match` is compared per tag so a weakened or multi-tag validator still
  answers 304, the appearance cookie's options live in one place rather than
  being decided two ways, the shell reads the logo on the viewer's own row
  instead of opening a third transaction per load, and the invitation email's
  remote image is documented as the read receipt it is.
