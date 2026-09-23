# 116: Docs section with Fumadocs

**What to build:** Taha, 2026-09-23: docs page wanted; "Fumadocs + Scalar if both can be adapted well enough to match the exact design language", then picked Fumadocs native for API pages after the prototype (https://claude.ai/artifact/EoU7puGTQbBCxZwHnt7Ton).

**Where the ask forks, and what was picked (Taha's picks).**

- Fumadocs inside apps/web at `/docs`, same deploy and domain. Themed through `--color-fd-*` to Direction A; dark mode follows `data-theme`.
- Guides from the repo's docs: install, how collection works, configuration, self-hosting, API keys. Built-in search.
- Versions pinned exactly; the Fumadocs stylesheet scoped so it does not leak into the dashboard.

**Blocked by:** 111.

**Status:** todo

- [ ] `/docs` with sidebar, search, MDX guides
- [ ] Theme matches, light and dark
- [ ] Screenshots
