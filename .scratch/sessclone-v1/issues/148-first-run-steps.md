# 148: First-run steps in order, on the surfaces a new person lands on

**What to build:** Overnight review (2026-10-01) of what a just-approved
Owner sees on a phone, ahead of the 10-plan Personal pilot. Three places
stalled the way to a first Turn:

- Creating a key showed the key and a one-line install command that said
  "after step 1 below". Step 1 sat past the key list, so a reader on a phone
  ran step 2 first and the install failed.
- Costs with no key said only "You have no API key yet", with nothing about
  what follows the button.
- Devices with nothing reported named "Keys" in prose with no way to get
  there.

**What was decided (overnight, unattended; Taha may change any of it).**

- The new-key reveal lists the whole setup in order: add the marketplace,
  install with this key (shell-history caveat kept), restart Claude Code.
  The marketplace command lives once in `lib/install-command.ts`.
- Costs' no-key sentence says the rest of the way: create a key, install the
  Collector, first Turn shows a moment after Claude Code next answers.
- Devices' empty state links to Keys ("Set up a machine").

**Blocked by:** none

**Status:** done

- [x] Reveal renders marketplace, install, restart in order (render test, red
      before the change)
- [x] Costs and Devices empty-state copy and action
- [x] Screenshots at 390 and 1440, light and dark
