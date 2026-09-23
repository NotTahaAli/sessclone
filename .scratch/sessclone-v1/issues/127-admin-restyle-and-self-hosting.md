# 127: Admin in Direction A, and a deployment that names itself

**What to build:** Taha, 2026-09-23. Restyle every `/admin` page with the Direction A primitives, and give the admin shell a way back to the dashboard. Also replace the hard-coded `sessclone.com` contact and install URLs with this deployment's own.

**Where the ask forks, and what was picked.**

- Behaviour and queries are unchanged: only markup and classes move. The pages use Rows, SectionBreaks, Field lines, round fields and buttons.
- The Orgs list puts the ones waiting for approval under their own break, first.
- "Back to dashboard" always goes to `/costs`. For an operator whose own Org is locked, `/costs` is the waiting page.
- `CONTACT_EMAIL` comes from `contactEmail()` with no fallback. With no address set, contact links hide or point at the repository's issues.
- The docs use `<SiteUrl />`, `<SiteHost />` and `<SiteCode />`.

**Blocked by:** 48, 126.

**Status:** done

- [x] Admin pages and shell restyled; screenshots at 1440 and 390, light and dark
- [x] `site.ts` unit tests
