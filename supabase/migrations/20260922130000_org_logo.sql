-- Ticket 77, fourth criterion: "An Owner or Admin uploads an Org logo, which
-- appears in the signed-in nav, on sign-in, and in invite email, and which a
-- Member cannot remove."
--
-- The bytes live in Postgres rather than in object storage, which is the
-- opposite of what `AGENTS.md` § Efficiency says for transcripts, so here is
-- why this one is different:
--
--  - **Two of the three places it appears have no session.** The invite email
--    is fetched by somebody else's mail client and the sign-in page by a
--    visitor who has not signed in yet. A presigned GET expires, and a public
--    bucket is a second access model to get wrong.
--  - **Storage is optional.** `storageConfigured()` is false on a deployment
--    that never turned archival on, and a self-hoster should not have to stand
--    up S3 to put their own logo in the corner of their own dashboard.
--  - **It is one small image.** 256 kB at the outside, changed approximately
--    never, served with an ETag. A transcript is megabytes per Session and
--    would flatten the same route.
--
-- Its own table rather than columns on `orgs`: `orgs` is read on nearly every
-- request, and a `bytea` in it would ride along with each of those reads.

create table org_logos (
  org_id uuid primary key references orgs (id) on delete cascade,
  bytes bytea not null,
  -- Three raster formats. **Never `image/svg+xml`**: an SVG served from this
  -- origin is a document, so a logo could carry script and run it as the
  -- dashboard. `lib/org-logo.ts` decides the type from the bytes themselves
  -- rather than from what the browser claimed.
  content_type text not null,
  -- Stored because they were parsed anyway to prove the bytes are an image,
  -- and because `<img width height>` in an email wants them.
  width integer not null,
  height integer not null,
  updated_at timestamptz not null default now(),

  constraint org_logos_type_check
    check (content_type in ('image/png', 'image/jpeg', 'image/webp')),
  -- Belt and braces with the same bound in `lib/org-logo.ts`: a route that
  -- forgot to check could otherwise put a video in a row every visitor's
  -- browser then downloads.
  constraint org_logos_size_check
    check (octet_length(bytes) between 1 and 262144),
  constraint org_logos_dimensions_check
    check (width between 64 and 8192 and height between 64 and 8192)
);

alter table org_logos enable row level security;

-- The one other `using (true)` read policy in the schema, beside `tiers_read`,
-- and for the reason `lib/db.ts` § `readAnonymously` demands be written down:
-- this table holds a picture an Org publishes in its own invitation emails.
-- There is no membership to test, because the reader is a mail client or a
-- visitor on the sign-in page. The row carries no name, no address and no id
-- but the Org's own — which the reader already had, since it is in the URL
-- they asked for.
create policy org_logos_read on org_logos for select using (true);

-- The criterion's second half: a Member cannot remove it. `sessclone_admin_org_ids()`
-- is Owner and Admin, the same set that may set the Org's accent, and it
-- governs all three verbs — an update is a replacement and a delete is a
-- removal, and a Member gets neither.
create policy org_logos_set on org_logos for insert
  with check (org_id in (select sessclone_admin_org_ids()));

create policy org_logos_replace on org_logos for update
  using (org_id in (select sessclone_admin_org_ids()))
  with check (org_id in (select sessclone_admin_org_ids()));

create policy org_logos_remove on org_logos for delete
  using (org_id in (select sessclone_admin_org_ids()));

grant select, insert, update, delete on org_logos to sessclone_app;

/**
 * The Org an invitation belongs to, for the sign-in page somebody reached from
 * one (ticket 77: "appears in the signed-in nav, on sign-in, and in invite
 * email").
 *
 * `security definer` for the same reason `sessclone_accept_invitation` is: the
 * person following the link is signed out, or signed in as somebody who is in
 * no Org at all, and `invitations_read` is Owner and Admin. The token is what
 * authorises the lookup, and it arrives as its hash, so this function never
 * receives the secret either.
 *
 * It returns a name and a timestamp and nothing else — not the address invited,
 * not the Role, not whether some *other* invitation exists. A spent, revoked or
 * expired token returns no row, which is the same answer as a token that was
 * never issued.
 */
create or replace function sessclone_invitation_org(presented_hash text)
  returns table (org_id uuid, org_name text, logo_updated_at timestamptz)
  language sql stable security definer
  set search_path = pg_catalog, public, pg_temp as $$
  select org.id, org.name, logo.updated_at
    from invitations invite
    join orgs org on org.id = invite.org_id
    left join org_logos logo on logo.org_id = org.id
   where invite.token_hash = presented_hash
     and invite.accepted_at is null
     and invite.revoked_at is null
     and invite.expires_at > now()
$$;

grant execute on function sessclone_invitation_org(text) to sessclone_app;
