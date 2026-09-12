# 0003 — Transcript bytes never pass through the application

**Status:** accepted · 2026-09-12 · ticket 12

## Context

A Log Artifact is the raw transcript of one Session. They are large, they grow
for the life of a session, and they are the largest data volume in the product
by a wide margin — while the application is one Next.js deployment whose job is
dashboards and a small ingest route.

Routing those bytes through the application buys nothing and costs request
duration, memory, and a platform's body-size limit.

## Decision

The Collector uploads straight to storage through a presigned PUT. The
application issues the URL and never carries the bytes.

**The flow.** The Collector computes the SHA-256 of the transcript and calls
`POST /api/logs/presign` with the Session, the Project, and the hash. The route
authorises the request, and either returns a short-lived PUT URL or refuses.

**The Project in the request is advisory.** The route resolves the Session to
its Project from the Turns already ingested, and authorises against that. A
Collector runs on the Member's machine, so a Project key it supplies is a claim,
and honouring it would let an excluded Project be archived by sending a
different key — defeating the only enforcement point ADR 0005 has.
The Collector then PUTs the file directly to storage and reports the upload so
the `log_artifacts` row records its storage key, hash, size, and time.

**The hash guard sits on the presign, not on the upload.** Refusing to issue a
URL when the stored hash already matches means an unchanged transcript costs
one small request rather than a re-upload. Putting the guard after the bytes
have moved would be a guard that has already paid the cost it exists to avoid.

**Five refusals, each distinguishable from the others**, because a Collector
that cannot tell "you never opted in" from "this repository is excluded" cannot
tell the member which switch to flip:

1. the submitted hash matches what is stored;
2. the Member's archival master switch is off (ADR 0005);
3. the Member has excluded that Session's Project (ADR 0005);
4. the Org's Tier does not include archival at all;
5. the Session has no ingested Turns yet, so its Project cannot be resolved.
   This one is transient — the Collector retries on the next opportunity — but
   it is a distinct answer from any refusal a member could act on.

**Only S3-compatible APIs are used.** Endpoint, bucket, and credentials are env
vars; no code path knows the provider. Hosted runs on Supabase Storage, the
operator's alternate is Oracle Cloud Object Storage, and a self-hoster points
at R2, AWS, or MinIO unchanged. Storage is the one dependency a self-hoster is
most likely to already have, so tying the product to one vendor's SDK would be
a tax on the free tier.

**Object naming.**

```
orgs/<org_id>/members/<member_id>/projects/<project_key>/<session_id>.jsonl
```

A Project key contains slashes (`host/owner/repo`, or a `local:` key carrying
an absolute path), so it is percent-encoded into a single path segment. Left
raw it would both break the prefix and let a collector-supplied path escape its
own prefix.

The latest upload replaces the prior one at the same key. One object per
Session, not forty partial versions: the use case is feeding a whole session to
an analysis agent, which partial copies only obstruct.

The key carries Member and Project rather than Session alone. Ticket 02
measured a Session id shared by two different conversations — a nested
`claude -p` reported its parent's `session_id` while writing a separate
transcript under a different project directory. Under a flat
`orgs/<org>/sessions/<session_id>.jsonl` those two overwrite each other, and
the survivor is whichever uploaded last. Including the Project separates the
collision that was actually observed, and makes a per-Project deletion a prefix
sweep rather than a query — which ADR 0005 needs.

## Consequences

The application's ingest path stays small enough to run anywhere, which is what
makes self-hosting on plain Postgres plus any S3 bucket viable.

A Session that changes Project mid-run would write under two keys. That is the
same underlying gap ticket 09 has to close; until it does, the duplicate is
visible and recoverable, which a silent overwrite is not.

Presigned URLs are bearer credentials with a short life. They are issued only
for the requesting Member's own Session, and their expiry is short enough that
a leaked URL is a small window rather than a standing grant.
