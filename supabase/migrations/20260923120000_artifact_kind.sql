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
-- second copy of its transcript.
--
-- The old key stays for now. Production applies migrations before the new
-- code deploys, and the code still live in that window upserts with
-- `on conflict (member_id, session_id, agent_id)`, which needs a unique key on
-- exactly those columns. Keeping both costs nothing a transcript can notice:
-- every row the new key would refuse the old key refuses too. What the old key
-- does refuse meanwhile is a sidecar beside its own run's transcript, and the
-- confirm route answers that with a 503 the Collector retries. The old key is
-- dropped by `20260923140000_artifact_kind_drop_old_key.sql`, after the deploy.
alter table log_artifacts
  add constraint log_artifacts_identity_key
    unique nulls not distinct (member_id, session_id, agent_id, kind);
