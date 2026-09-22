# 78: Session failures view

**What to build:** The surface that shows a person why a Session failed. Ticket 40 records the failure type and message against the Session; nothing in the product reads it, so a Collector that stops reporting looks the same as a quiet week.

**Blocked by:** 17, 40, 45, 53.

**Status:** done

- [x] Failures listed beside the Costs views, sharing the same date-range control
- [x] Scoped by Role exactly as every other view is, proven against the policies rather than through the UI
- [x] Each row names the Session, the Device, when it failed and the recorded failure type and message
- [x] Says plainly what a person can do about the common cases, rather than only that something failed
- [x] The onboarding waiting surface links here once a first Turn has arrived, since that is where a stalled Collector is first noticed

The failures surface is drawn in `docs/design/dashboard-wireframes.md`, under "Two surfaces drawn ahead of their tickets".

## What landed

- `lib/failures.ts` — `sessionFailures` (rows: session, agent, type, message,
  device, member; newest first, capped at `FAILURES_LIMIT` with a `more`
  count) and `countFailures` for the tab badge. Role scoping is the
  `session_events_read` policy (visible_member_ids), proven in
  `test/failures.test.ts` as the unprivileged role — Owner/Admin see the Org,
  Manager their Scope, Member themselves, and one Org's failures never leak.
  Range cut in the Org's timezone, as the cost views are.
- `lib/failure-advice.ts` — advice for the recorded error types (`rate_limit`,
  `overloaded`, `billing_error`), each saying whether costs are affected; an
  unknown type gets no advice and the row shows the recorded message as-is.
- `costs/failures-list.tsx` + a fifth `Failures` tab in `costs/views.ts` and
  `costs/page.tsx`, sharing the date-range control, with a count badge.
  Phone-first single column.
- The onboarding waiting surface links to the failures view when the period
  holds any — where a stalled Collector is first noticed.
- `supabase/migrations/20260922090000_session_failure_index.sql` — partial
  index `(org_id, occurred_at desc, id desc) where kind = 'stop_failure'`, so
  the read is index-backed.
- Screenshots (1440x900 and 390x844, light and dark) in project files
  `shots-ticket-78/`.

Note: the failures view is grounded in the error types ticket 40 actually
records (the spec's `rate_limit`/`overloaded`/`billing_error`), not the
wireframe's looser "rejected key / failed upload" prose, which name failure
sources the collector does not produce.
