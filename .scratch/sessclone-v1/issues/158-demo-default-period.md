# 158: Demo pages open on a period that holds data

**What to build:** coordinator, 2026-10-01, overnight while Taha slept. Ticket
152 sent `/demo` to Costs on the last 30 days, but the nav's bare `/costs` and
`/sessions` still defaulted to the calendar month. A demo day is seeded only
once it has ended, so on the 1st those tabs read "Nothing in this period".

**What was decided.**

- A page with no period in its URL opens on `defaultPreset(viewer)`: the last
  30 days for the demo visitor, the calendar month for everybody else. Real
  Orgs are unchanged.
- `ResolvedRange` carries that `fallback`, so the period menu omits `range`
  from the link for whichever preset is the default here, and a bare URL and
  its menu link always agree.
- Seeding today instead was rejected: the refresh is daily, and a day seeded
  before it ends shows Turns with future times.

**Blocked by:** 152

**Status:** done

- [x] Demo default period, with a test red without the fix
