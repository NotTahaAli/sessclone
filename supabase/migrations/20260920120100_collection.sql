-- Ticket 22: the collection tables, and the unique index that makes ingest
-- idempotent.
--
-- ADR 0006 settles what a Turn is: `(member_id, session_id, agent_id,
-- message_id)`, enforced by a unique index, with ingest writing
-- `ON CONFLICT DO NOTHING`. The Collector re-reports by design — a lost cursor,
-- a drained retry queue, a `SessionStart` sweep — so the constraint is the
-- dedup rather than a check that happens to agree with one.

-- A machine, as one Member sees it. Keyed per Member: two Members may own a
-- laptop called `build-box`, and `deviceKey` in packages/shared computes the
-- same string for both, so the uniqueness has to be scoped here.
create table devices (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members (id) on delete restrict,
  key text not null check (length(btrim(key)) > 0),
  -- Display only, and the Member's to change. The key is the identity.
  nickname text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (member_id, key)
);

-- The codebase a Session ran against, keyed by normalised git remote or, with
-- no repository, by `local:<hostname>:<path>`. Scoped to the Org, so one
-- repository cloned by four Members is one Project and per-Project spend is
-- not split by who cloned it. `remote` keeps what git actually reported, minus
-- any credential embedded in it, so a key can be explained.
create table projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  key text not null check (length(btrim(key)) > 0),
  remote text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (org_id, key)
);

-- Usage exactly as reported, and no money: ADR 0002 computes Cost at read time
-- from the Rate table, so adding a Rate reprices history and a model with no
-- Rate yields null rather than zero. `reported_cost_usd` is the column for a
-- real figure from Claude Code itself; nothing in v1 populates it.
create table turns (
  id bigint generated always as identity primary key,
  org_id uuid not null references orgs (id) on delete cascade,
  member_id uuid not null references members (id) on delete restrict,
  device_id uuid references devices (id) on delete set null,
  project_id uuid references projects (id) on delete set null,

  session_id text not null check (length(btrim(session_id)) > 0),
  -- Null for a main Session. An Agent Run carries its parent's session id, so
  -- without this column a subagent's Turns would collide with the Session that
  -- spawned it whenever both reused a message id.
  agent_id text,
  message_id text not null check (length(btrim(message_id)) > 0),
  occurred_at timestamptz not null,

  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cache_read_input_tokens integer not null default 0 check (cache_read_input_tokens >= 0),
  -- The reported total, kept beside the split rather than derived from it: a
  -- capture that reports a total with no split would otherwise look like zero
  -- cache creation instead of an unexplained one.
  cache_creation_input_tokens integer not null default 0 check (cache_creation_input_tokens >= 0),
  cache_creation_5m_input_tokens integer not null default 0 check (cache_creation_5m_input_tokens >= 0),
  cache_creation_1h_input_tokens integer not null default 0 check (cache_creation_1h_input_tokens >= 0),
  -- A subset of output_tokens, not an addition to it.
  thinking_tokens integer not null default 0 check (thinking_tokens >= 0),
  web_search_requests integer not null default 0 check (web_search_requests >= 0),
  web_fetch_requests integer not null default 0 check (web_fetch_requests >= 0),

  -- Every dimension that changes a price or explains one. All nullable: a
  -- transcript may state none of them, and `<synthetic>` is a real model value
  -- that no Rate will ever match.
  model text,
  service_tier text,
  speed text,
  inference_geo text,
  client_version text,
  -- Reported by the Agent Run rather than assumed to be one level. It lives in
  -- the sidecar meta file and is absent on some runs, so it is nullable here.
  spawn_depth integer check (spawn_depth is null or spawn_depth >= 0),
  -- The handle a Claude Code Cloud session carries, so a Turn can be traced
  -- back to the environment that produced it.
  cloud_session_handle text,

  -- False when every entry of the group carried `stop_reason: null`: the run
  -- died mid-stream, so these counters are a floor and not a total.
  complete boolean not null default true,
  reported_cost_usd numeric check (reported_cost_usd is null or reported_cost_usd >= 0),
  received_at timestamptz not null default now()
);

-- ADR 0006's key, and the reason ingest never reads before it writes. `nulls
-- not distinct` is what makes a main Session's null agent_id collapse rather
-- than making every re-report a new row — without it the index would not
-- dedup the very case it exists for.
create unique index turns_identity_key
  on turns (member_id, session_id, agent_id, message_id)
  nulls not distinct;

-- The two reads the dashboard actually makes: an Org's spend over time, and
-- one Member's. Charts query `turns` directly; there are no rollup tables.
create index turns_org_occurred_at_idx on turns (org_id, occurred_at);
create index turns_member_occurred_at_idx on turns (member_id, occurred_at);
create index turns_project_occurred_at_idx on turns (project_id, occurred_at);
create index turns_device_occurred_at_idx on turns (device_id, occurred_at);

-- What the Collector's hooks observed about a Session, which is how a sweep
-- knows a Session is not complete and needs re-reporting. The kinds are the
-- hook set the spec names; tickets 38 and 40 own extending it.
create table session_events (
  id bigint generated always as identity primary key,
  org_id uuid not null references orgs (id) on delete cascade,
  member_id uuid not null references members (id) on delete restrict,
  device_id uuid references devices (id) on delete set null,
  session_id text not null check (length(btrim(session_id)) > 0),
  agent_id text,
  kind text not null check (kind in ('session_start', 'session_end', 'stop_failure')),
  occurred_at timestamptz not null,
  detail jsonb,
  received_at timestamptz not null default now()
);

-- A `SessionStart` fires twice around a compaction and a requeued report may
-- arrive twice, so the same observation lands once.
create unique index session_events_identity_key
  on session_events (member_id, session_id, agent_id, kind, occurred_at)
  nulls not distinct;

create index session_events_session_idx on session_events (member_id, session_id);

-- ADR 0005's per-Project setting, which sits inside the Member's master switch
-- on `members`. A Project with no row here inherits that switch: this is an
-- opt-out list, not an allow list, because an allow list silently archives
-- nothing and the Member finds out when they go looking for a transcript that
-- was never uploaded.
create table member_project_archival (
  member_id uuid not null references members (id) on delete cascade,
  project_id uuid not null references projects (id) on delete cascade,
  archival_enabled boolean not null,
  updated_at timestamptz not null default now(),
  primary key (member_id, project_id)
);

alter table devices enable row level security;
alter table projects enable row level security;
alter table turns enable row level security;
alter table session_events enable row level security;
alter table member_project_archival enable row level security;

-- Every read below resolves through `sessclone_visible_member_ids()`, which is
-- where Owner, Admin, Manager-with-a-Scope and Member are decided — once, in
-- the accounts migration, rather than restated per table.

create policy devices_read on devices for select
  using (member_id in (select sessclone_visible_member_ids()));

-- The nickname is the Member's to set. Nothing else on the row is writable
-- through a policy at all: ingest writes devices as the service role.
create policy devices_rename on devices for update
  using (member_id in (select sessclone_own_member_ids()))
  with check (member_id in (select sessclone_own_member_ids()));

create policy projects_read on projects for select
  using (org_id in (select sessclone_org_ids()));

-- Read-only to every Role. `turns` is append-only and written by ingest with
-- the service role, which bypasses policies — so there is deliberately no
-- insert, update or delete policy here. A re-report must never rewrite stored
-- Usage, and nothing that reaches the browser may write a Turn at all.
create policy turns_read on turns for select
  using (member_id in (select sessclone_visible_member_ids()));

create policy session_events_read on session_events for select
  using (member_id in (select sessclone_visible_member_ids()));

-- The exception list is the Member's own, in both directions. An Admin governs
-- the Org's data and settings, and this is the one setting they do not reach:
-- ADR 0005 keeps archival inside the Member's decision, so an Admin can
-- neither read nor write another Member's exclusions.
create policy member_project_archival_own on member_project_archival for all
  using (member_id in (select sessclone_own_member_ids()))
  with check (member_id in (select sessclone_own_member_ids()));
