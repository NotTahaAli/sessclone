-- Ticket 78's read, index-backed.
--
-- The failures view lists stop failures for one Org over a date range:
-- `where org_id = … and kind = 'stop_failure' and occurred_at >= … < …
--  order by occurred_at desc, id desc limit 100`.
--
-- `session_events` had `session_events_identity_key` (member, session, agent,
-- kind, occurred_at) and `session_events_session_idx` (member, session) —
-- neither leads with the Org, and both bury `occurred_at` behind columns the
-- read does not constrain, so the plan was a scan of the Org's whole event
-- history filtered down to the failures. Most rows are `session_start` and
-- `session_end`; a stop failure is the rare one.
--
-- A partial index on the failures alone, in the order the query asks for them,
-- is therefore both small (it holds only the rows the view ever reads) and
-- terminating (the limit stops the scan rather than a sort).
create index if not exists session_events_failure_idx
    on session_events (org_id, occurred_at desc, id desc)
    where kind = 'stop_failure';
