# 86: Sessions list, and what one session did

**What to build:** A Sessions destination listing the Sessions in the selected period, and a detail surface for one of them.

Everything in the product is currently aggregate: Costs ranks models, projects, devices and people, and a Session appears only when it failed (ticket 78). A person who asks "what did that long session on Thursday cost, and what ran inside it?" has nowhere to look.

**The list.** One row per Session in the range, sharing the date-range control (ticket 53) and the Role scoping every other view has — the policies decide, not the query (ADR 0001). Each row names the Session, its Project, its Device, the person, when it started and ended, its Turn count and its cost. Filterable by project and by person, and sorted newest first. Paginated; a busy Org has thousands.

**The detail.** One Session: start and end (end from the `session_end` marker, absent when the session never ended cleanly, which is a fact worth showing rather than hiding), total tokens by kind, cost, the Turns in order, and the Agent Runs — subagents report under the same session id with their own `agent_id` (finding 74), so they group rather than needing a new record. A transcript download link when a transcript was archived for that Session, and when it was not, the row is shown with the reason (archival is opt-in per Member, off by default) rather than hidden — an absent link reads as a bug.

Turn rows here are the same component ticket 88 builds for the Costs drill-down; neither should grow its own.

**Blocked by:** 22, 42, 53, 60, 85.

**Status:** open

- [ ] Sessions lists the period's Sessions with project, device, person, start, end, Turns and cost
- [ ] Filter by project and by person; paginated; newest first
- [ ] Role scoping proven against the policies as the unprivileged role, not through the UI
- [ ] A Session's detail shows its Turns in order and its Agent Runs grouped under it
- [ ] The transcript download appears when one is stored, and says why when one is not
- [ ] A Session with no end marker says so rather than showing a blank or a guess
- [ ] The reads are index-backed; no query in a loop
- [ ] Screenshots at 1440x900 and 390x844, light and dark
