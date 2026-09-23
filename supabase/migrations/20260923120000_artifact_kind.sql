-- Ticket 104: a Session's sidecars are archived beside its transcripts.
--
-- Each Agent Run writes an `agent-<id>.meta.json` next to its transcript, and
-- each workflow run a `journal.jsonl` under its run id. They ride the same
-- presign and confirm as the transcripts, so they are `log_artifacts` rows —
-- told apart by `kind` rather than kept in a table of their own, which would
-- need its own policies, its own retention and its own deletion path to say
-- what these already say.
--
-- `agent_id` keeps its meaning per kind: the Agent Run's id for a transcript
-- or its `agent_meta`, and the workflow's run id (`wf_…`) for a
-- `workflow_journal`.
--
-- Existing rows are all transcripts, which the default says. No function is
-- touched, and the policies are unchanged: a sidecar is readable and
-- deletable by exactly who may read and delete the transcript beside it.

alter table log_artifacts
  add column kind text not null default 'transcript'
    constraint log_artifacts_kind_check
    check (kind in ('transcript', 'agent_meta', 'workflow_journal'));

comment on column log_artifacts.kind is
  'transcript, or a sidecar of one: agent_meta (agent-<id>.meta.json, '
  'agent_id is the run) or workflow_journal (journal.jsonl, agent_id is the '
  'workflow run id). Only transcripts are listed; deleting one takes its '
  'sidecars.';

-- The identity grows by the kind, so a run's sidecar is not refused as a
-- second copy of its transcript. Dropped and added in one statement, so there
-- is no moment without a unique key for the confirm route's `on conflict`.
alter table log_artifacts
  drop constraint log_artifacts_member_id_session_id_agent_id_key,
  add constraint log_artifacts_identity_key
    unique nulls not distinct (member_id, session_id, agent_id, kind);
