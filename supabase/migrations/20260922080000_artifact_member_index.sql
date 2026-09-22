-- The Member's own transcript list, index-backed.
--
-- `/settings/you` (ticket 73) reads
-- `where member_id = … order by uploaded_at desc, id desc limit 101`. The
-- indexes it had were `(org_id, uploaded_at)`, `(member_id)` and
-- `(project_id)`, so the plan was a bitmap scan of the Member's whole history
-- followed by a sort — the page paid for every Session a Member has ever
-- archived in order to show the newest hundred.
--
-- The order matters: the columns are indexed in the direction the query asks
-- for them, so the limit stops the scan rather than the sort.
create index log_artifacts_member_uploaded_idx
    on log_artifacts (member_id, uploaded_at desc, id desc);
