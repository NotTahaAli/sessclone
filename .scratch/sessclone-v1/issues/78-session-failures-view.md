# 78: Session failures view

**What to build:** The surface that shows a person why a Session failed. Ticket 40 records the failure type and message against the Session; nothing in the product reads it, so a Collector that stops reporting looks the same as a quiet week.

**Blocked by:** 17, 40, 45, 53.

**Status:** ready-for-agent

- [ ] Failures listed beside the Costs views, sharing the same date-range control
- [ ] Scoped by Role exactly as every other view is, proven against the policies rather than through the UI
- [ ] Each row names the Session, the Device, when it failed and the recorded failure type and message
- [ ] Says plainly what a person can do about the common cases, rather than only that something failed
- [ ] The onboarding waiting surface links here once a first Turn has arrived, since that is where a stalled Collector is first noticed

The failures surface is drawn in `docs/design/dashboard-wireframes.md`, under "Two surfaces drawn ahead of their tickets".
