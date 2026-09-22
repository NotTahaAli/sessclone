# 99: Cloud transcripts are archived after every turn

**What to build:** Taha, 2026-09-22: "I want transcripts from cloud sessions too." Archival runs at `SessionEnd` and in the next `SessionStart` sweep (ticket 59). A Claude Code cloud container gets neither: it never runs `SessionEnd`, archive and reclaim included (ticket 95), and the next session starts in a fresh container without this one's files. So no cloud transcript was ever uploaded.

**Where the ask forks, and what was picked (Taha's picks).**

- **Every turn, in the background, whole file.** A second `Stop` hook, `hooks/stop-archive.mjs`, registered `async: true` so the turn never waits and Claude Code enforces no timeout. The upload replaces the Session's one object (ADR 0003), so the stored copy is at most one turn behind.
- **Cloud only** (`CLAUDE_CODE_REMOTE=true`). Local machines keep `SessionEnd` and the sweep and spend no bytes per turn.
- The deployment still decides: nothing leaves the container unless the Member's archival switch is on.

**Blocked by:** 98.

**Status:** done

- [x] `hooks/stop-archive.mjs` beside `stop.mjs`, through the proxy (ticket 98), sixty-second budget and fifty seconds per upload
- [x] `archiveAfterTurn`: a per-Session lock so overlapping turns never confirm out of order, and one retry after `no_turns` so a first turn that beats its flush is still archived. Both tested, each red with its fix reverted
- [x] `archivesEveryTurn` tested for cloud and local; the manifest test pins the hook as the only async `Stop` entry
- [x] Checked from a cloud container: presign answered through the proxy, and the storage host is reachable
- [x] `docs/install.md` and `docs/configuration.md` updated
- [x] A cloud Session's transcript downloads from the dashboard, seen on production by Taha (2026-09-22: 808 KB, 114 lines, ending at that Session's last turn)
