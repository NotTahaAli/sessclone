# 140: Download every transcript at once

**What to build:** Taha, 2026-09-25: "also add an option to download all transcripts", with "filters for what to download (time frame, projects, devices, members)".

**What was picked (Taha's decisions, 2026-09-25).**

1. **Scope is what the viewer can already download one at a time** in the active Org: Owner and Admin the whole Org, a Manager their Scope, a Member their own.
2. **One zip**, streamed, one folder per person and Project, from a button on the Transcripts page.
3. **Filters:** time frame, Projects, Devices, Members.
4. **Time frame is the transcript's own span** (Taha, 2026-09-25): first Turn to last. Any overlap with the range brings the transcript whole. Read past the history window.
5. **Fix the zip's limits** (Taha, 2026-09-25): deflated, so Java's `ZipInputStream` reads it, and ZIP64. The caps that remain (2,000 transcripts, 8 GiB raw) are what one 300-second function can stream.

**Blocked by:** none

**Status:** done

- [x] Zip route streams from storage without holding a file in memory
- [x] Same read rules as the single download; tested per Role
- [x] Filter form on the Transcripts page
- [x] Dates by transcript span; Device filter, onboarding and archival list read past the window
- [x] Deflate + ZIP64, read back by Python, Java and Info-ZIP
