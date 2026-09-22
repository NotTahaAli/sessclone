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
