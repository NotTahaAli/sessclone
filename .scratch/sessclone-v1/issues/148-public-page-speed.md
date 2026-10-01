# 148: Public page speed and layout stability

**What to build:** coordinator, 2026-10-01, overnight while Taha slept: measure
Lighthouse mobile on the live landing, pricing and docs pages and fix the
biggest real wins, without changing copy, design or the structured data from
ticket 147.

**What was decided.**

- Docs pages no longer ship the API playground. `mdx-components.tsx`
  imported the client `OpenAPIPage` statically, so its Base UI forms and
  highlighter rode in every docs page's bundle. It now loads through
  `next/dynamic` in a client module (`openapi-page-lazy.tsx`), still
  server-rendered on the one API page.
- "Try the demo" streams in after the session read and used to arrive into
  nothing, rewrapping the hero's buttons: a 0.106 layout shift on a phone,
  over the 0.1 "good" line. The shell now holds an invisible, unlinked copy of
  the button, so only a signed-in reader, for whom it disappears, sees space
  close.
- next/font's Geist fallback names `local(Arial)` alone, which Android, Linux
  and the Lighthouse runner do not have. A second fallback face in
  `globals.css` with the same overrides covers Liberation Sans, Arimo
  (both Arial-metric) and Roboto (average width within 0.3% of Arial).

**Blocked by:** none

**Status:** done

- [x] Playground code split, measured per route
- [x] Demo link placeholder, with a render test
- [x] Fallback face, checked with fonts delayed in Chromium
