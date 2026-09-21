-- Ticket 24: tiers, subscriptions, subscription events, and log artifacts.
--
-- ADR 0004 is the whole shape of this file: v1 ships no payment rail, models
-- plans and seat limits anyway, and carries the extensibility in the schema
-- rather than in an adapter interface written against an imagined provider.
-- So every provider column below is nullable and unread — `provider` is
-- `manual` throughout v1 — and entitlement checks read status and Tier only.

-- What a plan includes. Prices live here rather than in code because the
-- platform admin page edits them (ticket 65) and the landing page reads them
-- (ticket 80); a price in a constant is a deployment, and there is exactly one
-- place a price is allowed to live.
--
-- `base_price_usd` beside `seat_price_usd` is what lets a flat plan and a
-- per-seat plan be the same row: a flat $5 personal plan is a base with a zero
-- seat price, and a $10-per-seat team plan is the reverse. Both null means
-- "contact us", which is a real tier and not a missing value — hence no
-- default and no not-null.
--
-- `retention_max_days` null means no ceiling, and `max_seats` null means no
-- limit. Null as "unbounded" rather than a sentinel like 0 or 2147483647: a
-- sentinel is a number that compares, and one day it compares wrongly.
create table tiers (
  id uuid primary key default gen_random_uuid(),
  -- Stable across renames, and what code names when it has to name one.
  key text not null unique check (length(btrim(key)) > 0),
  name text not null check (length(btrim(name)) > 0),
  description text,
  base_price_usd numeric check (base_price_usd is null or base_price_usd >= 0),
  seat_price_usd numeric check (seat_price_usd is null or seat_price_usd >= 0),
  included_seats integer not null default 0 check (included_seats >= 0),
  min_seats integer check (min_seats is null or min_seats >= 1),
  max_seats integer check (max_seats is null or max_seats >= 1),
  -- The ceiling on the Org's own retention setting (ticket 61). The Org sets a
  -- window; the Tier says how large it may be.
  retention_max_days integer check (retention_max_days is null or retention_max_days > 0),
  -- The one capability v1 gates outright, and the reason it is a column rather
  -- than a key in `features`: ADR 0005 keys the whole archival path off it, and
  -- a jsonb key that a typo makes false is a silent opt-out of a promise.
  archival_available boolean not null default false,
  -- Every further gate. ADR 0004: the next one is a data change, not a
  -- migration.
  features jsonb not null default '{}'::jsonb,
  -- Display order on the pricing page, so the landing page does not sort by
  -- price and put "contact us" in an arbitrary place.
  sort_order integer not null default 0,
  -- A tier withdrawn from sale still has to price the Orgs already on it.
  available boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (max_seats is null or min_seats is null or max_seats >= min_seats)
);

-- `updated_at` is only true if something writes it, and a column that reads as
-- the insert time forever is worse than no column: it answers the question
-- wrongly rather than not at all.
create or replace function sessclone_touch_updated_at() returns trigger
  language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create trigger tiers_touch_updated_at
  before update on tiers
  for each row execute function sessclone_touch_updated_at();

create type subscription_status as enum ('inactive', 'active', 'past_due', 'cancelled');

-- One row per Org, and the only place an entitlement check looks. The Tier
-- lives here rather than on `orgs` so that status and Tier are read together,
-- from one row, by one query — a check that reads a Tier from one table and a
-- status from another is a check that can read a torn pair.
--
-- The four provider columns are ADR 0004's extensibility. They are nullable,
-- nothing reads them, and they are the reason adding Stripe or Polar later is
-- a webhook route rather than a migration.
create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null unique references orgs (id) on delete cascade,
  tier_id uuid not null references tiers (id) on delete restrict,
  status subscription_status not null default 'inactive',
  provider text not null default 'manual' check (length(btrim(provider)) > 0),
  provider_customer_id text,
  provider_subscription_id text,
  provider_metadata jsonb,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The audit trail, append-only. Every activation writes one — the manual path
-- is the first implementation of it rather than a special case that skips it,
-- so when a provider's webhook arrives it writes the same rows and the history
-- before and after is one series.
--
-- `tier_id` and `status` are copied onto the event rather than read back
-- through the subscription: the point of a history is what was true then, and
-- a join to the current row answers a different question.
create table subscription_events (
  id bigint generated always as identity primary key,
  subscription_id uuid not null references subscriptions (id) on delete cascade,
  org_id uuid not null references orgs (id) on delete cascade,
  status subscription_status not null,
  tier_id uuid not null references tiers (id) on delete restrict,
  -- Null for an event a provider's webhook wrote, since no person did it.
  actor_user_id uuid references users (id) on delete set null,
  provider text not null,
  provider_event_id text,
  note text,
  occurred_at timestamptz not null default now()
);

create index subscription_events_org_idx on subscription_events (org_id, occurred_at desc);

-- "Every activation writes a subscription event" is a schema guarantee here
-- rather than a rule the activation route is trusted to remember. A route that
-- forgets leaves an Org active with no record of who did it, and the gap is
-- only ever discovered when somebody asks.
--
-- `security definer` so the event lands without granting anyone an insert on
-- the table: there is no insert policy and no insert grant on
-- `subscription_events` at all, so the trigger is the only writer and a row
-- can be neither forged nor suppressed.
--
-- The note travels on a transaction-local setting because it is the one part
-- of the event the database cannot know. Ticket 48 sets it beside the update;
-- absent, the event still lands, with no note.
create or replace function sessclone_write_subscription_event() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE'
     and new.status is not distinct from old.status
     and new.tier_id is not distinct from old.tier_id then
    return new;
  end if;

  insert into subscription_events
    (subscription_id, org_id, status, tier_id, actor_user_id, provider, note)
  values (
    new.id, new.org_id, new.status, new.tier_id, sessclone_user_id(), new.provider,
    nullif(current_setting('sessclone.subscription_note', true), '')
  );

  return new;
end
$$;

create trigger subscriptions_touch_updated_at
  before update on subscriptions
  for each row execute function sessclone_touch_updated_at();

create trigger subscriptions_write_event
  after insert or update on subscriptions
  for each row execute function sessclone_write_subscription_event();

-- ADR 0003: the bytes go straight to storage through a presigned PUT and the
-- application never carries them. This row is what the application does hold —
-- enough to find the object, prove it is the one that was uploaded, and know
-- when it may be removed.
--
-- One row per Session, or per Agent Run within one, and ticket 59 replaces the
-- object as the Session grows rather than accumulating versions — so the
-- unique key below is the Session's identity minus the message, and an upload
-- updates `sha256`, `size_bytes` and `uploaded_at` in place.
create table log_artifacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete restrict,
  member_id uuid not null,
  -- Set where the Session's Project is known, so ticket 73's per-Project sweep
  -- and ticket 61's retention can both find their rows. Nullable because a
  -- Session outside any repository still has a transcript.
  project_id uuid references projects (id) on delete set null,
  session_id text not null check (length(btrim(session_id)) > 0),
  -- As on `turns`: null for a main Session, never the empty string, so the two
  -- spellings of absence cannot store one Session twice.
  agent_id text check (agent_id is null or length(btrim(agent_id)) > 0),
  -- The object's key in the bucket. Unique because two rows naming one object
  -- means deleting either orphans or destroys the other's bytes.
  storage_key text not null unique check (length(btrim(storage_key)) > 0),
  -- SHA-256, lowercase hex. What ticket 59 compares to decide an unchanged
  -- transcript needs no re-upload.
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes bigint not null check (size_bytes >= 0),
  uploaded_at timestamptz not null default now(),
  foreign key (org_id, member_id) references members (org_id, id) on delete restrict,
  unique nulls not distinct (member_id, session_id, agent_id)
);

-- Retention sweeps by age within an Org (ticket 61); the Project sweep is by
-- prefix in storage but by this index in the database (ticket 73).
create index log_artifacts_org_uploaded_at_idx on log_artifacts (org_id, uploaded_at);
create index log_artifacts_member_idx on log_artifacts (member_id);
create index log_artifacts_project_idx on log_artifacts (project_id);

alter table tiers enable row level security;
alter table subscriptions enable row level security;
alter table subscription_events enable row level security;
alter table log_artifacts enable row level security;

-- Tiers are the price list. The landing page reads them without a session at
-- all (ticket 80), so this is the one table in the schema readable by nobody
-- in particular — which is correct: it is what is printed on the pricing page.
create policy tiers_read on tiers for select using (true);

create policy tiers_write on tiers for all
  using ((select sessclone_is_platform_admin()))
  with check ((select sessclone_is_platform_admin()));

-- Billing is the Owner's business, and everyone in the Org can see which plan
-- they are on — a Member told "this Tier does not include archival" needs to
-- be able to see the Tier. Nothing here is a price only the Owner may know;
-- the prices are on the public pricing page.
create policy subscriptions_read on subscriptions for select
  using (
    org_id in (select sessclone_org_ids())
    or (select sessclone_is_platform_admin())
  );

-- Activation is the operator's (tickets 48 and 65), never the customer's. An
-- Owner who could write this row could activate their own subscription.
create policy subscriptions_write on subscriptions for all
  using ((select sessclone_is_platform_admin()))
  with check ((select sessclone_is_platform_admin()));

-- Read-only to every Role, and written only by the trigger above.
create policy subscription_events_read on subscription_events for select
  using (
    org_id in (select sessclone_org_ids())
    or (select sessclone_is_platform_admin())
  );

-- Who may download what (ticket 60): a Member their own, an Owner and Admin
-- any Member's, a Manager only their Scope. Which is exactly the set
-- `sessclone_visible_member_ids()` already returns.
create policy log_artifacts_read on log_artifacts for select
  using (member_id in (select sessclone_visible_member_ids()));

-- Destroying a transcript is the Member's own decision and nobody else's,
-- Owner included (ticket 73, ADR 0005). Deliberately narrower than the read
-- above: an Admin may download an artifact and may not destroy it.
create policy log_artifacts_delete on log_artifacts for delete
  using (member_id in (select sessclone_own_member_ids()));

-- No insert or update policy, as on `turns`: rows are written by the presign
-- route (ticket 58) with the service role, after it has verified an API key.
-- Nothing the browser can reach may claim an upload happened.

grant select on tiers, subscriptions, subscription_events, log_artifacts
  to sessclone_app;
grant insert, update, delete on tiers to sessclone_app;      -- tiers_write
grant insert, update on subscriptions to sessclone_app;      -- subscriptions_write
grant delete on log_artifacts to sessclone_app;              -- log_artifacts_delete
-- `subscription_events` deliberately gets no write verb at all: the trigger is
-- `security definer` and writes as the owner, so the audit trail has exactly
-- one author.
