-- Ticket 21: the account tables and their policies.
--
-- ADR 0001 puts every authorisation rule in row-level security, and says a
-- table ships with its policies in the same migration — a migration that
-- leaves policies to a later one has shipped a table readable by everyone in
-- the window between the two. So the policies are here, below their tables.

-- Who is asking. Supabase sets `request.jwt.claim.sub` at the start of each
-- request and that is what `auth.uid()` reads; the claims JSON is the same
-- value by another route. Reading both, rather than calling `auth.uid()`,
-- keeps these migrations applying to a plain Postgres — which is what CI and a
-- self-hoster run, and what the route tests apply from empty.
create or replace function sessclone_user_id() returns uuid language sql stable as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
    ),
    ''
  )::uuid
$$;

create type member_role as enum ('owner', 'admin', 'manager', 'member');

create table orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  created_at timestamptz not null default now()
);

-- `is_platform_admin` is a flag on the user and not a Role: a Platform Admin
-- operates the deployment and is outside every Org, while an Owner governs one
-- Org and must never reach global pricing.
create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null check (length(btrim(email)) > 0),
  is_platform_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index users_email_key on users (lower(email));

-- A Member is a person inside one Org. `removed_at` rather than a delete: a
-- removed Member stops consuming a Seat, and their historical Turns still have
-- to reconcile, so the row stays and `turns` keeps pointing at it.
--
-- `archival_enabled` is ADR 0005's master switch, off by default. It is the
-- one place in this model where an Admin is not a superset of a Member: the
-- trigger below refuses the write to anyone but the Member themselves.
create table members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  user_id uuid not null references users (id) on delete restrict,
  role member_role not null default 'member',
  archival_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  unique (org_id, user_id),
  -- Not redundant with the primary key: it is what lets `member_scopes` name
  -- an Org and a Member in one foreign key, so a Manager cannot be scoped to
  -- somebody in a different Org.
  unique (org_id, id)
);

create index members_user_id_idx on members (user_id);

-- The key itself is never stored. `key_hash` is what a presented key is
-- checked against and `key_prefix` is the handful of characters the dashboard
-- shows so a Member can tell two keys apart.
create table api_keys (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members (id) on delete cascade,
  label text not null check (length(btrim(label)) > 0),
  key_hash text not null unique,
  key_prefix text not null check (length(key_prefix) between 4 and 16),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index api_keys_member_id_idx on api_keys (member_id);

-- The set of Members a Manager may see. No row means an empty Scope, which
-- sees nobody — the absence is the default, not a special case.
create table member_scopes (
  org_id uuid not null references orgs (id) on delete cascade,
  manager_member_id uuid not null,
  member_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (manager_member_id, member_id),
  foreign key (org_id, manager_member_id) references members (org_id, id) on delete cascade,
  foreign key (org_id, member_id) references members (org_id, id) on delete cascade
);

create index member_scopes_member_id_idx on member_scopes (member_id);

-- The four questions every policy below asks, answered once. They are
-- `security definer` so that a policy on one table may consult another without
-- that table's own policy recursing into this one, and `stable` so a policy
-- can wrap the call in `(select …)` and have Postgres run it once per
-- statement rather than once per row.
create or replace function sessclone_is_platform_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from users where id = sessclone_user_id() and is_platform_admin
  )
$$;

-- The Orgs the caller belongs to. A removed Member belongs to none of them.
create or replace function sessclone_org_ids() returns setof uuid
  language sql stable security definer set search_path = public as $$
  select org_id from members
   where user_id = sessclone_user_id() and removed_at is null
$$;

create or replace function sessclone_admin_org_ids() returns setof uuid
  language sql stable security definer set search_path = public as $$
  select org_id from members
   where user_id = sessclone_user_id()
     and removed_at is null
     and role in ('owner', 'admin')
$$;

-- The caller's own membership rows, which is what "their own usage" means.
create or replace function sessclone_own_member_ids() returns setof uuid
  language sql stable security definer set search_path = public as $$
  select id from members
   where user_id = sessclone_user_id() and removed_at is null
$$;

-- Every Member the caller may see: themselves, everyone in an Org they own or
-- administer, and the Scope of each Org where they are a Manager. A removed
-- Member is still visible to an Admin — their Turns are still in the history —
-- but a removed Member sees nothing themselves.
create or replace function sessclone_visible_member_ids() returns setof uuid
  language sql stable security definer set search_path = public as $$
  select id from members
   where user_id = sessclone_user_id() and removed_at is null
  union
  select peer.id from members peer
   where peer.org_id in (select sessclone_admin_org_ids())
  union
  select scope.member_id from member_scopes scope
    join members manager on manager.id = scope.manager_member_id
   where manager.user_id = sessclone_user_id()
     and manager.removed_at is null
     and manager.role = 'manager'
$$;

create or replace function sessclone_visible_user_ids() returns setof uuid
  language sql stable security definer set search_path = public as $$
  select sessclone_user_id()
  union
  select user_id from members where id in (select sessclone_visible_member_ids())
$$;

-- Nobody may hand themselves the deployment. The flag is outside every Org, so
-- no Role reaches it; only somebody who already has it may grant it.
create or replace function sessclone_guard_platform_admin() returns trigger
  language plpgsql as $$
begin
  if new.is_platform_admin is distinct from old.is_platform_admin
     and not sessclone_is_platform_admin() then
    raise exception 'only a platform admin may change is_platform_admin';
  end if;
  return new;
end
$$;

create trigger users_guard_platform_admin
  before update on users
  for each row execute function sessclone_guard_platform_admin();

-- Two columns of `members` that the update policy alone cannot separate: a
-- Member may write their own archival switch and nothing else, and an Owner or
-- Admin may write a Role but never somebody else's archival switch.
create or replace function sessclone_guard_member_columns() returns trigger
  language plpgsql as $$
begin
  if new.archival_enabled is distinct from old.archival_enabled
     and old.user_id is distinct from sessclone_user_id() then
    raise exception 'archival is the member''s own switch';
  end if;

  if new.role is distinct from old.role
     and old.org_id not in (select sessclone_admin_org_ids()) then
    raise exception 'only an owner or admin may change a role';
  end if;

  return new;
end
$$;

create trigger members_guard_columns
  before update on members
  for each row execute function sessclone_guard_member_columns();

alter table orgs enable row level security;
alter table users enable row level security;
alter table members enable row level security;
alter table api_keys enable row level security;
alter table member_scopes enable row level security;

-- No role is named on any policy below. Supabase's `authenticated` and
-- `service_role` do not exist on a plain Postgres, and the service role
-- bypasses policies anyway (ADR 0001 confines it to ingest paths that have
-- already verified an API key by hash).

create policy orgs_read on orgs for select
  using (
    id in (select sessclone_org_ids())
    or (select sessclone_is_platform_admin())
  );

create policy orgs_create on orgs for insert
  with check ((select sessclone_user_id()) is not null);

create policy orgs_write on orgs for update
  using (id in (select sessclone_admin_org_ids()))
  with check (id in (select sessclone_admin_org_ids()));

create policy users_read on users for select
  using (
    id in (select sessclone_visible_user_ids())
    or (select sessclone_is_platform_admin())
  );

create policy users_write_self on users for update
  using (id = (select sessclone_user_id()))
  with check (id = (select sessclone_user_id()));

create policy members_read on members for select
  using (
    id in (select sessclone_visible_member_ids())
    or (select sessclone_is_platform_admin())
  );

create policy members_invite on members for insert
  with check (org_id in (select sessclone_admin_org_ids()));

-- Two writers, one policy, and the trigger above decides which column each of
-- them owns.
create policy members_write on members for update
  using (
    org_id in (select sessclone_admin_org_ids())
    or user_id = (select sessclone_user_id())
  )
  with check (
    org_id in (select sessclone_admin_org_ids())
    or user_id = (select sessclone_user_id())
  );

-- A key is personal. An Admin governs the Org's data and settings; nothing is
-- served by letting them list another Member's keys, even as hashes.
create policy api_keys_own on api_keys for all
  using (member_id in (select sessclone_own_member_ids()))
  with check (member_id in (select sessclone_own_member_ids()));

create policy member_scopes_read on member_scopes for select
  using (
    org_id in (select sessclone_admin_org_ids())
    or manager_member_id in (select sessclone_own_member_ids())
  );

create policy member_scopes_assign on member_scopes for insert
  with check (org_id in (select sessclone_admin_org_ids()));

create policy member_scopes_revoke on member_scopes for delete
  using (org_id in (select sessclone_admin_org_ids()));
