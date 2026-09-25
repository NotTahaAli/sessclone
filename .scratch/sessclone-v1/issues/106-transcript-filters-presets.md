# 106: Transcript filters, thinking modes and saved presets

**What to build:** Taha, 2026-09-23: "Thinking (Hidden, Collapsed, Verbose modes) … the normal view should only contain Model Message, User Message, Collapsed Tool Use, Collapsed Thinking, Visible Subagent and Workflow Blocks." Later: "allow setting custom presets per User."

**Where the ask forks, and what was picked (Taha's picks).**

- Filter chips per type, built-in Normal and All presets, and presets each person saves to their account (so they follow them across devices) with one default.
- A preset holds the chips and the thinking mode. Thinking defaults to Collapsed; empty thinking reads "text not stored".
- Normal adds compaction points, interrupts, API errors, model switches, slash commands and failed or blocking hooks to Taha's list.

**Blocked by:** 103

**Status:** done

- [ ] `transcript_view_presets` table with its RLS policies in one migration
- [ ] Server actions to list, save, delete and set default
- [ ] Policy tests as the unprivileged role
- [ ] Migration applied to production before the merge deploys
