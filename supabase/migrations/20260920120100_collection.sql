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
  unique (org_id, key),
  -- As on `members`: what lets a child row name an Org and a Project in one
  -- foreign key, so an exception cannot point across an Org boundary.
  unique (org_id, id)
);

-- Usage exactly as reported, and no money: ADR 0002 computes Cost at read time
-- from the Rate table, so adding a Rate reprices history and a model with no
-- Rate yields null rather than zero. `reported_cost_usd` is the column for a
-- real figure from Claude Code itself; nothing in v1 populates it.
create table turns (
  id bigint generated always as identity primary key,
  -- `restrict`, not `cascade`: deleting an Org must not be the one edge in
  -- this graph that erases spend history. Removal is `members.removed_at`, and
  -- an Org that genuinely has to go is an explicit operation that deals with
  -- its Turns first.
  org_id uuid not null references orgs (id) on delete restrict,
  member_id uuid not null,
  device_id uuid references devices (id) on delete set null,
  project_id uuid references projects (id) on delete set null,

  session_id text not null check (length(btrim(session_id)) > 0),
  -- Null for a main Session. An Agent Run carries its parent's session id, so
  -- without this column a subagent's Turns would collide with the Session that
  -- spawned it whenever both reused a message id.
  --
  -- Null or a real id, never the empty string: the identity index treats two
  -- nulls as equal and two empty strings as equal, but a null and an empty
  -- string as different — so a caller that spelled absence both ways would
  -- store one Turn twice, which is the overcount the index exists to stop.
  agent_id text check (agent_id is null or length(btrim(agent_id)) > 0),
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
  received_at timestamptz not null default now(),

  -- One key, two columns, so a Turn cannot be filed under an Org its Member
  -- does not belong to. Such a row is invisible to everyone — the read policy
  -- resolves by Member, and every Org chart filters by Org — so it is spend
  -- that exists and reconciles against nothing.
  foreign key (org_id, member_id) references members (org_id, id) on delete restrict
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
  org_id uuid not null references orgs (id) on delete restrict,
  member_id uuid not null,
  device_id uuid references devices (id) on delete set null,
  session_id text not null check (length(btrim(session_id)) > 0),
  agent_id text check (agent_id is null or length(btrim(agent_id)) > 0),
  kind text not null check (kind in ('session_start', 'session_end', 'stop_failure')),
  occurred_at timestamptz not null,
  detail jsonb,
  received_at timestamptz not null default now(),
  foreign key (org_id, member_id) references members (org_id, id) on delete restrict
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
-- `org_id` is not decoration: without it a Member of one Org could write an
-- exception against another Org's Project, which is a row that can never be
-- legitimately produced and an oracle for whether a foreign Project exists.
create table member_project_archival (
  org_id uuid not null references orgs (id) on delete restrict,
  member_id uuid not null,
  project_id uuid not null,
  archival_enabled boolean not null,
  updated_at timestamptz not null default now(),
  primary key (member_id, project_id),
  foreign key (org_id, member_id) references members (org_id, id) on delete cascade,
  foreign key (org_id, project_id) references projects (org_id, id) on delete cascade
);

-- `devices_rename` grants the row, and a row is every column on it. The key is
-- what `deviceKey` computes and what the per-Device breakdown groups on, and
-- the two timestamps are the row's only provenance: a Member renaming their
-- laptop must not be able to re-point or backdate it.
create or replace function sessclone_guard_device_columns() returns trigger
  language plpgsql as $$
begin
  if new.id is distinct from old.id
     or new.member_id is distinct from old.member_id
     or new.key is distinct from old.key
     or new.first_seen_at is distinct from old.first_seen_at then
    raise exception 'only the nickname is the member''s to change';
  end if;
  return new;
end
$$;

create trigger devices_guard_columns
  before update on devices
  for each row execute function sessclone_guard_device_columns();

-- `force` as well as `enable`, for the reason the accounts migration gives:
-- the owner is exempt from `enable` alone, and `turns` is the table that makes
-- that concrete — it carries no write policy at all, so an exempt owner is a
-- forged Turn away from a wrong bill.
alter table devices enable row level security;
alter table devices force row level security;
alter table projects enable row level security;
alter table projects force row level security;
alter table turns enable row level security;
alter table turns force row level security;
alter table session_events enable row level security;
alter table session_events force row level security;
alter table member_project_archival enable row level security;
alter table member_project_archival force row level security;

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

-- A Project key may be `local:<hostname>:<absolute path>`, which is a Member's
-- machine name and directory layout. ADR 0005 allows that to be visible to
-- whoever may see that Member's Projects — which under the Role model is the
-- Member, an Owner or Admin, and a Manager the Member is scoped to. Org-wide
-- would hand every Member of an Org the Owner's home directory, and would show
-- a Manager with an empty Scope something.
create or replace function sessclone_visible_project_ids() returns setof uuid
  language sql stable security definer set search_path = public as $$
  select id from projects where org_id in (select sessclone_admin_org_ids())
  union
  select distinct project_id from turns
   where member_id in (select sessclone_visible_member_ids())
     and project_id is not null
$$;

create policy projects_read on projects for select
  using (id in (select sessclone_visible_project_ids()));

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

-- `sessclone_visible_project_ids()` reads `turns` and `projects`, both forced,
-- so it needs the same owner and the same grants the accounts migration
-- explains.
grant select on devices, projects, turns, session_events, member_project_archival
  to sessclone_rls;

alter function sessclone_visible_project_ids() owner to sessclone_rls;
