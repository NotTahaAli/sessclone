-- Ticket 104, second half. RUN THIS AFTER THE DEPLOY THAT SHIPS TICKET 104,
-- never before it.
--
-- `20260923120000_artifact_kind.sql` added `(member_id, session_id, agent_id,
-- kind)` beside the old three-column key rather than in place of it, because
-- the confirm route live before that deploy upserts on the old key and would
-- fail every confirm without it. Once the new code is serving, nothing names
-- the old key, and it is what still refuses a run's `agent_meta` sidecar
-- beside that run's transcript (the confirm route answers 503 and the
-- Collector retries until this has run).
alter table log_artifacts
  drop constraint log_artifacts_member_id_session_id_agent_id_key;
