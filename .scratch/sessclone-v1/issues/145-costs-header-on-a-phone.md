# 145: Costs header controls on a phone

**What to build:** Taha, 2026-09-29: on a phone the Costs view pill (Projects,
People, …) drops to a line of its own under the period pill, and its menu
opens off the left edge of the screen, where it cannot be seen.

**What was decided.**

- The period and view pills are one group: on a phone they wrap under the
  title together and sit on one row, the muted detail truncating first.
- A header pill menu stays right-aligned under its pill, but never closer than
  8px to either side of the screen, so a pill on the left no longer pushes it
  off.

**Blocked by:** none

**Status:** done

- [x] Pill menu placement clamped to the viewport, with a unit test
- [x] Costs period and view pills kept on one row at 390px
