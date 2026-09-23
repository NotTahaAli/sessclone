# 111: Direction A foundations: tokens, type, logo, shell

**What to build:** Taha, 2026-09-23 (design thread). Drafts: https://claude.ai/artifact/Uuajtx2pP65ZrLhMRjJhir. "I really like the transcript layout. Change the whole dashboard to be similar in style." Picked Direction A ("Log") and logo R1 ("Sigma prompt").

**Where the ask forks, and what was picked (Taha's picks).**

- Replaces ticket 16's visual layer: warm ivory / warm charcoal neutrals, Geist + Geist Mono, almost no boxes or shadows.
- Accent used as sparingly as on the transcript page: live state, the current bar, the logo stroke. Org/Member accent seeds keep working.
- Shared primitives: row (chevron, name, right-aligned mono value, sub line, meter), hairline section break with a centred label, header pill menu with an SVG chevron, fg-filled primary button, switch, segmented pill, swatch row.
- Logo R1: the prompt chevron closed into a sum sign, bottom stroke in the accent. SVG mark, lockup, favicon and app icon.
- Shell: 232px sidebar with the Usage / Collector / Manage groups; phone bottom bar unchanged in content.

**Status:** done

- [x] Tokens and fonts in `globals.css`, light and dark, `data-theme` and system
- [ ] Primitives built and used by the transcript page too — built in `apps/web/app/_ui/` and used by the shell; the transcript page already reads the shared tokens, and switching its markup to the primitives is left to the thread that owns that page

The one unticked box is the transcript page's markup, which another thread owns; everything this ticket owns is done.

- [x] Logo, favicon, app icon
- [x] Screenshots 1440x900 + 390x844, light and dark
