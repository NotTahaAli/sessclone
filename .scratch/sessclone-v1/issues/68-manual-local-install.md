# 68: Manual verification — local install

**What to build:** Confidence that the install works on a real machine, on each supported operating system. Automating this would mean automating Claude Code.

**Blocked by:** 06, 66.

**Status:** done

- [x] Fresh install performed on macOS. Linux and Windows are unavailable to the
      operator, so neither was exercised; `docs/findings/68-local-install.md`
      records both rows as untested rather than passing.
- [x] Hooks fire after restart on macOS; Turns arrive
- [x] Cursor and queue files land where the spike said they would
- [x] Findings recorded, including anything the documentation failed to warn about

Closed on macOS evidence alone. A Linux or Windows machine appearing later is a
new ticket, not a reopening of this one: the finding names exactly what each of
those rows would have to show.
