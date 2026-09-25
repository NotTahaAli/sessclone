-- Ticket 139's history window hides old Turns from every read through the
-- `turns_read` policy. Three readers are not showing Turns, only facts about
-- them, and must see past the window:
--
-- - a transcript's time span and Devices, for the download-all filters
--   (ticket 140): a transcript from last year is still stored and still
--   downloadable, and its dates come from its Turns;
-- - whether an Org has any Turns at all, for onboarding: an Org whose Turns
--   are all older than its window is not one that never collected;
-- - which Projects a person has Sessions in, for the archival opt-outs.
--
-- Each is a definer function (the policy is what hides the rows) that
-- answers only about Members the caller can already see, as the policy does
-- apart from the window.

-- The first and last Turn of one transcript (a Session, or one subagent of
-- it), and every Device its Session reported from. Null span for a
-- transcript whose Turns are gone or never came; the caller falls back to
-- the upload time. `turns_identity_key` leads on (member_id, session_id).
create or replace function sessclone_transcript_span(
  member uuid, session text, agent text
) returns table (started_at timestamptz, ended_at timestamptz, device_ids uuid[])
  language sql stable security definer
  set search_path = pg_catalog, public, pg_temp as $$
  select min(turn.occurred_at) filter (where turn.agent_id is not distinct from agent),
         max(turn.occurred_at) filter (where turn.agent_id is not distinct from agent),
         coalesce(array_agg(distinct turn.device_id)
                    filter (where turn.device_id is not null), '{}')
    from turns turn
   where turn.member_id = member
     and turn.session_id = session
     and member in (select sessclone_visible_member_ids())
$$;

-- Whether the Org has a Turn from anyone the caller can see, however old.
create or replace function sessclone_org_has_turns(org uuid) returns boolean
  language sql stable security definer
  set search_path = pg_catalog, public, pg_temp as $$
  select exists (
    select 1 from turns turn
     where turn.org_id = org
       and turn.member_id in (select sessclone_visible_member_ids())
  )
$$;

-- The (Member, Project) pairs of the caller's own Turns, however old.
create or replace function sessclone_own_turn_projects()
  returns table (member_id uuid, project_id uuid)
  language sql stable security definer
  set search_path = pg_catalog, public, pg_temp as $$
  select distinct turn.member_id, turn.project_id
    from turns turn
   where turn.member_id in (select sessclone_own_member_ids())
     and turn.project_id is not null
$$;

revoke execute on function sessclone_transcript_span(uuid, text, text) from public;
revoke execute on function sessclone_org_has_turns(uuid) from public;
revoke execute on function sessclone_own_turn_projects() from public;
grant execute on function sessclone_transcript_span(uuid, text, text) to sessclone_app;
grant execute on function sessclone_org_has_turns(uuid) to sessclone_app;
grant execute on function sessclone_own_turn_projects() to sessclone_app;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function sessclone_transcript_span(uuid, text, text) from anon, authenticated;
    revoke execute on function sessclone_org_has_turns(uuid) from anon, authenticated;
    revoke execute on function sessclone_own_turn_projects() from anon, authenticated;
  end if;
end
$$;
