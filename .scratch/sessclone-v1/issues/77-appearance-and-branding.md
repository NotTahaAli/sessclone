# 77: Appearance and branding settings

**What to build:** The settings the design system's derived half assumes exist — an Org's accent seed and its logo, and a Member's own accent and light or dark preference. Ticket 16 defines the tokens these values feed; nothing in the product writes them today.

**Blocked by:** 16, 44, 45, 58.

**Status:** ready-for-agent

- [ ] An Owner or Admin sets the Org's default accent seed, and chooses whether Members may override it
- [ ] A Member sets their own accent seed and their light, dark, or system preference, unless the Org has locked the seed
- [ ] The six derived accent values are computed once on save and stored, so the colour library never reaches the browser bundle
- [ ] An Owner or Admin uploads an Org logo, which appears in the signed-in nav, on sign-in, and in invite email, and which a Member cannot remove
- [ ] No Role can write another Member's appearance settings, proven as SQL against the policies rather than through the UI
- [ ] Theme applies on first paint with no flash, including for a signed-out visitor on the marketing site
