# 166: Collector status bar and commands as a mod

**What to build:** Taha, 2026-10-02, after Claude Code shipped mods
(https://code.claude.com/docs/en/plugins/mods/overview): status and sync as
commands instead of skills, and an always-visible bar showing whether
sessclone is connected, how far behind it is, whether this session is synced,
and an icon that opens the session on sessclone.

**What was decided.**

- The bar is the band above the prompt (no site sits at the very top; the
  status line under the prompt cannot hold a link and is drawn as a warning).
- "Behind" is this session's Turns past its cursors plus failed pushes queued.
- `/sessclone-status` and `/sessclone-sync` (a mod command cannot hold `:`).
  Sync runs the session-start check and sweep at once with the key the mod
  hands it, no Claude turn.
- The skills stay as the fallback where mods cannot load, hidden from the
  menu where the mod loads.
- The link opens `/sessions/<id>` without `member`, which now means the
  viewer's own Session in the active Org.
- Released as 0.5.0.

**Blocked by:** none

**Status:** done

- [x] Bar drawn in a real Claude Code 2.1.287 session, wide and narrow
- [x] Commands answer without a turn
- [x] Fallback skills hidden where the mod loads
