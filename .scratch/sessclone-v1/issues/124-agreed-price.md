# 124: An Org's agreed price, shown on its Tier page

**What to build:** Taha, 2026-09-23: "when an org is enterprise, show the decided price in settings." Enterprise showed "Contact", and nothing stored a negotiated price.

**Where the ask forks, and what was picked.**

- Base plus per seat, monthly, in US cents, nullable, on the Org's `subscriptions` row.
- A Platform Admin sets or clears both on the admin Org page, in the existing subscription form.
- An agreed price wins over the Tier's on any Tier; without one the page is as before.

**Blocked by:** 47, 48.

**Status:** done

- [x] Additive migration, existing policies
- [x] Admin form and action, zod-parsed
- [x] Tier page price; formatting unit-tested; Owner refused as `sessclone_app`
