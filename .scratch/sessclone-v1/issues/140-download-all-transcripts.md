# 140: Download every transcript at once

**What to build:** Taha, 2026-09-25: "also add an option to download all transcripts", with "filters for what to download (time frame, projects, devices, members)".

**What was picked (Taha's decisions, 2026-09-25).**

1. **Scope is what the viewer can already download one at a time** in the active Org: Owner and Admin the whole Org, a Manager their Scope, a Member their own.
2. **One zip**, streamed, one folder per person and Project, from a button on the Transcripts page.
3. **Filters:** time frame, Projects, Devices, Members.

**Blocked by:** none

**Status:** todo

- [ ] Zip route streams from storage without holding a file in memory
- [ ] Same read rules as the single download; tested per Role
- [ ] Filter form on the Transcripts page
