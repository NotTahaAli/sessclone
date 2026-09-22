# 95: Cloud Sessions report no end, and the dashboard says so

**What to build:** A Session that ran in a Claude Code cloud container reads as a cloud Session whose last Turn is known, not as a Session missing its end. Reported by Taha on 2026-09-22: no cloud Session ever records an end, and archiving a cloud session does not run the hook either.

Finding 05 already says `SessionEnd` fires about 180ms after SIGTERM and never under SIGKILL. In a cloud container it does not fire at all, archived or reclaimed alike, so every cloud Session carried the amber "no end recorded" warning that is meant for the abnormal case. Nothing is lost by it: the Collector flushes at every turn boundary (finding 69), so the only loss is a turn still in flight when the container dies.

**What is reachable, and what was picked.**

- **Nothing on the server can learn that a cloud session was archived.** That state lives on claude.ai and needs the member's own claude.ai credentials. The one signal the deployment has is the Device key, which is `cloud:<account uuid>` for a cloud container (`deviceKey` in `packages/shared`).
- **Shown as the last Turn, neutral, not as an ending (Taha's pick, option a).** No idle timeout inventing an end after N hours: a guess dressed as a fact is what the existing null was avoiding.
- **A cloud environment that sets `SESSCLONE_DEVICE` loses the prefix** and reads as a machine again. Accepted: the key is all the server knows.
- **No migration.** `cloud` is `bool_or(device.key like 'cloud:%')` over the Session's Turns.

**Blocked by:** 86.

**Status:** done

- [x] `sessionList` and `sessionDetail` return `cloud` per Session
- [x] Sessions list: a cloud Session with no end marker shows "last Turn <time> · cloud, no end reported", not the warning
- [x] Session detail: the Ended tile becomes "Last Turn" for a cloud Session with no end marker
- [x] `docs/install.md` states that cloud Sessions never record an end, and why nothing is lost
- [ ] Looked at on production by Taha. No screenshots: the container this was built in had no Supabase session, so no signed-in page could be driven in it
