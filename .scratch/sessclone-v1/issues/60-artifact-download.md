# 60: Log artifact download

**What to build:** A whole Session transcript, downloadable by the people entitled to it, so it can be fed to an analysis tool.

**Blocked by:** 44, 58, 59.

**Status:** done

- [x] A Member downloads their own transcripts
- [x] An Owner and Admin download any Member's; a Manager only those in their Scope
- [x] Download issued as a short-lived link, so the application never serves the bytes
- [x] Access covered by the policy suite, including the Manager-outside-Scope refusal

## What landed

- `GET /api/logs/download/<artifact id>` — authorises, signs, and answers 302
  to storage, so the bytes never pass through the application on the way out
  either (ADR 0003). `Cache-Control: no-store`, because the signed URL expires
  and is a bearer credential while it lives.
- `downloadableArtifact` in `lib/artifacts.ts` — one read through `asViewer`
  that names no Member and filters on nothing but the id: the
  `log_artifacts_read` policy (`sessclone_visible_member_ids()`) is the whole
  authorisation, so a Member gets their own, an Owner and an Admin any
  Member's, and a Manager only their Scope. It also builds the download's
  filename from the same row — `<session>.jsonl`, or
  `<session>-agent-<id>.jsonl` for an Agent Run.
- `presignDownload` in `lib/storage.ts` — `GetObject` with
  `ResponseContentDisposition`, so a browser saves a readable name rather than
  rendering a percent-encoded object key. The filename is stripped of quotes
  and control characters, because it is built from a Session id a Collector
  sent.
- A Download link beside each session on the stored-transcripts surface. A
  plain link, because a download is a GET: bookmarkable, retryable, and
  usable from `curl`.
- `apps/web/test/artifact-download.test.ts` — eight cases through the real
  policy as the unprivileged role: the Member, the Owner and Admin, the
  Manager in and out of Scope, a Manager with an empty Scope, a removed
  Member (nothing, their own included, while the Owner still can), another
  Org's artifact, the filename for a Session and for an Agent Run, 401 with no
  session, 404 for a malformed id, and both 503s. Verified red by widening the
  read.
- Screenshots (1440x900 and 390x844, both themes) in project files
  `shots-ticket-60/`.

An artifact the viewer may not see is a 404 with the same body as an id that
does not exist: a distinguishable 403 would confirm that a transcript
somebody cannot see is there.

`asViewer` is redirected to the harness's `asUser` in that suite, deliberately:
the suite's `DATABASE_URL` is the role that owns the tables, and Postgres
applies no policy to an owner — so a policy test on that connection would pass
while enforcing nothing.

## Scope, stated rather than assumed

The route is the capability: it authorises through `log_artifacts_read`, so an
Owner, an Admin and a Manager in Scope are each answered 302 for a transcript
they may see, which is what stories 35 and 36 ask for. What is deferred is the
_listing_ — the only surface that renders a Download link is a Member's own
`/settings/you`, built on `storedSessions`, which filters on
`sessclone_own_member_ids()`. So another Member's transcript is reachable by
its id and is not yet browsable. Ticket 84 adds the Org-side listing.
