# 105: Transcript page with Finder-style columns

**What to build:** Taha, 2026-09-23: "I want a session transcript viewer, which shows when a subagent started, and a side pane for the subagent transcript in it, if there are multiple depths, keep increasing subpanes. Just like the MacOS finder Columns view, Horizontally Scrollable."

**Where the ask forks, and what was picked (Taha's picks).**

- Page at `/sessions/<id>/transcript`, linked from Session detail and the Transcripts list. Same access as Download.
- Browser fetches the file straight from storage and parses it; the main column opens at the end and loads earlier chunks as you scroll up, with Jump to start. Agent columns load whole and open at their start.
- Desktop: one column fills the width; with more, agent columns are 440px and the main column takes the rest (min 440px). Widths draggable (min 440px), remembered per browser.
- Phone: peeking columns 84% wide (option B of the rendered mockups), breadcrumb on top.
- Tapping an agent opens its column to the right; tapping it again closes it.
- Reload button, no auto-refresh. A Session with no archived transcript says so and links to the archive setting.
- Subagent block: type, description, model, status, duration, tool count, and the prompt the parent sent.
- Out of scope: search, links to one message, auto-refresh.

**Blocked by:** 103, 104

**Status:** done

- [x] `GET /api/transcripts/<sessionId>` returns short-lived storage links, 404 when nothing visible
- [x] Column view, chunked loading, phone layout, draggable widths
- [ ] Screenshots at 1440x900 and 390x844, light and dark, from a fixture harness (not recorded here; PR #40 and #41 carry viewer shots)
- [ ] Taha looks at it on production (open: Taha's check; code is merged, so Status is done)
