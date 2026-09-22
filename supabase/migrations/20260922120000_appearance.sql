-- Ticket 77: the appearance settings the design system's derived half assumes
-- exist.
--
-- `docs/design/design-system.md` § "Colour — accent, derived from a seed"
-- decides the shape: one seed per Org with a flag saying whether Members may
-- override it, one seed per Member, and a light/dark/system mode that is always
-- the Member's own — an Org may lock the colour and has no business locking
-- whether somebody reads at night.
--
-- The seed is stored *with* its resolved tones rather than alone. Resolving one
-- needs `@material/material-color-utilities` — HCT colour science, not
-- arithmetic a check constraint could do — and the alternative to storing the
-- answer is either recomputing it on every request or shipping the library to
-- the browser, which is the one thing the ticket's third criterion forbids.
-- `apps/web/lib/accent.ts` is the only writer, and `accent.test.ts` holds the
-- resolved values against the table the design system measured.

alter table orgs
  add column accent_seed text not null default '#D97757',
  add column accent_tones jsonb not null default '{
    "fill": "#DA7453",
    "onFill": "#390B00",
    "border": "#BA5C3D",
    "textLight": "#9B4427",
    "textDark": "#FFB59E",
    "subtleLight": "#FFEDE8",
    "subtleDark": "#5D1800"
  }'::jsonb,
  -- Off, so an Org that never visits the setting is an Org whose Members may
  -- choose. A lock is a decision somebody makes, not a default they inherit.
  add column accent_locked boolean not null default false;

-- Null is "inherit the Org's", not "grey": a Member who never opens the
-- setting reads the Org's accent, and an Org that later changes its seed
-- changes theirs with it rather than leaving them on a copy of the old one.
alter table members
  add column accent_seed text,
  add column accent_tones jsonb,
  add column theme text not null default 'system';

-- The canonical form `lib/accent.ts` writes: `#` and six upper-case digits.
-- Not cosmetic — a stored seed is compared against the preset list to decide
-- which swatch reads as selected, and `#d97757` would read as none of them.
alter table orgs
  add constraint orgs_accent_seed_check check (accent_seed ~ '^#[0-9A-F]{6}$');

alter table members
  add constraint members_accent_seed_check
    check (accent_seed is null or accent_seed ~ '^#[0-9A-F]{6}$'),
  -- A seed with no tones is an accent nothing can paint; tones with no seed is
  -- an accent nobody can edit. They are written together or not at all.
  add constraint members_accent_pair_check
    check ((accent_seed is null) = (accent_tones is null)),
  add constraint members_theme_check
    check (theme in ('light', 'dark', 'system'));

-- Appearance is the Member's own, exactly as archival is (ticket 72), and for
-- the same reason: `members_write` lets an Admin update their Org's rows, so
-- without this an Admin could set another Member's colours and their
-- light-or-dark preference. The Org's *default* is theirs to set — that is a
-- column on `orgs`, governed by `orgs_write` — and a Member's own row is not.
--
-- The lock is enforced here too. It could not be a policy: a policy grants or
-- refuses a whole row, and what is being refused is one column's new value
-- depending on a flag on another table.
-- **This is the whole function, and it is rewritten from the newest previous
-- copy** — `20260922030000_seat_ceiling.sql`, not from the original in
-- `20260920120000_accounts.sql`. Six migrations have replaced it, each adding a
-- clause, and `create or replace` keeps whichever body ran last: rebuilding it
-- from an older copy silently deletes every clause added since. It did exactly
-- that here first time round, dropping the re-admission carve-out, and the test
-- that caught it was `invitations.test.ts` rather than anything in this ticket.
create or replace function sessclone_guard_member_columns() returns trigger
  language plpgsql set search_path = pg_catalog, public, pg_temp as $$
declare
  readmitting boolean;
  locked boolean;
begin
  if tg_op = 'INSERT' then
    if new.archival_enabled and new.user_id is distinct from sessclone_user_id() then
      raise exception 'archival is the member''s own switch';
    end if;
    -- An invitation is an insert, so an inviter must not be able to create the
    -- row with somebody else's colours already chosen for them.
    if (new.accent_seed is not null or new.theme <> 'system')
       and new.user_id is distinct from sessclone_user_id() then
      raise exception 'appearance is the member''s own';
    end if;
    return new;
  end if;

  if new.org_id is distinct from old.org_id
     or new.user_id is distinct from old.user_id then
    raise exception 'a member row cannot change org or user';
  end if;

  readmitting := old.removed_at is not null
    and new.removed_at is null
    and old.user_id is not distinct from sessclone_user_id()
    and exists (
      select 1 from invitations invite
        join users account on lower(account.email) = lower(invite.email)
       where invite.org_id = old.org_id
         and account.id = old.user_id
         and invite.role = new.role
         and invite.accepted_at is null
         and invite.revoked_at is null
         and invite.expires_at > now()
    );

  if new.archival_enabled is distinct from old.archival_enabled
     and old.user_id is distinct from sessclone_user_id() then
    raise exception 'archival is the member''s own switch';
  end if;

  -- Ticket 77. Appearance is the Member's own, exactly as archival is, and for
  -- the same reason: `members_write` lets an Owner or an Admin update their
  -- Org's rows, so without this they could set somebody else's colours and
  -- whether that person reads at night.
  if (new.accent_seed is distinct from old.accent_seed
      or new.accent_tones is distinct from old.accent_tones
      or new.theme is distinct from old.theme)
     and old.user_id is distinct from sessclone_user_id() then
    raise exception 'appearance is the member''s own';
  end if;

  -- The mode is never locked. An Org locking its colour is a branding
  -- decision; whether somebody reads light or dark is not the Org's to take.
  if new.accent_seed is distinct from old.accent_seed then
    select org.accent_locked into locked from orgs org where org.id = new.org_id;
    if locked then
      raise exception 'this org has locked its accent colour';
    end if;
  end if;

  if new.role is distinct from old.role
     and old.org_id not in (select sessclone_admin_org_ids())
     and not readmitting then
    raise exception 'only an owner or admin may change a role';
  end if;

  if new.removed_at is distinct from old.removed_at
     and old.org_id not in (select sessclone_admin_org_ids())
     and not readmitting then
    raise exception 'only an owner or admin may remove or re-admit a member';
  end if;

  return new;
end $$;

-- The trigger itself is unchanged and still bound to the function above; this
-- migration only replaces the body. Stated because a reader looking for
-- `create trigger` here will not find one.

-- No new grant. `20260920120200_app_role.sql` already grants `update` on both
-- tables to `sessclone_app` at table level, which covers a column added later;
-- a column grant on top of that adds nothing but a second place to maintain.
