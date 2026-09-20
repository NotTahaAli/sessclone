# 30: Identity normalisation

**What to build:** Stable Device and Project keys, so one repository is one Project however each machine cloned it, and a cloud environment is one Device rather than a new one per container.

**Blocked by:** 01.

**Status:** done

- [x] Both spellings of one git remote normalise to the same Project key
- [x] Credentials and the git suffix stripped; raw remote retained for debugging
- [x] A non-repository directory keys distinctly per machine, never by bare directory name
- [x] Local Devices keyed by machine; a cloud environment keyed by account, not container
- [x] Device keys scoped per Member, so two Members may share a machine name

**Answer:** `packages/shared/src/identity.ts` exports `projectKey`,
`deviceKey`, `normaliseRemote` and `withoutEmbeddedCredentials`.

Nine committed spellings of one GitHub remote — scp and URL forms, `.git` and
not, with a port, with a trailing slash, in either case — reduce to
`github.com/nottahaali/sessclone`. A directory that is not a repository keys as
`local:<hostname>:<path>`, so two machines with the same folder name stay two
Projects.

**The retained remote is credential-stripped too.** The ticket asks for
credentials stripped and the raw remote kept, and the first time those were read
as separate clauses the key was clean while the retained copy still carried
`https://someone:ghp_…@`. That string is shipped to ingest and shown on a
dashboard to explain a key; a `projects` row is not somewhere anyone thinks to
look for a live token.

**The Windows drive-letter fold follows the path, not the platform.** Finding 06
measured one box spelling its own working directory both ways, 1,125 entries
against 281. Deciding the fold from `process.platform` would have reintroduced
that split everywhere the key is computed from a _stored_ `cwd` — ingest and
the dashboard both run on Linux — so the fold triggers on the path shape
`^[a-z]:[\\/]` instead and needs nothing from the caller.

**A string with a scheme gets exactly one reading.** Falling back to the scp
form let `file:///srv/git/repo.git` parse as the host `file`, which merged every
machine holding a bare repo at that path into one Project — the exact merge the
local key exists to prevent. The scp form now also requires a dot in the host,
which keeps `TODO:fix` and `C:\code\repo` out.

**Where the cloud account uuid comes from.** The spec asks for
`cloud:<account uuid>` without saying which field holds it. This session ran
inside a Claude Code Cloud container, so it was read off the environment and
recorded in `docs/findings/06-install-paths.md` under "Claude Code Cloud,
measured": `CLAUDE_CODE_ACCOUNT_UUID` is the key, `CLAUDE_CODE_REMOTE` is the
switch, `CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE` is the suffix when it is not
`cloud_default`, and `CLAUDE_CODE_CONTAINER_ID` is the field to avoid — it is
right there, it looks like a machine identity, and it changes every hour. When
the cloud names no account the key falls back to the hostname, so a variable
that disappears costs a Device split rather than a dropped Turn.

**The last criterion is half here and half in ticket 22.** `deviceKey` takes no
Member and cannot: two Members on one build box compute the same string. That
is the point — the key is unique _inside_ a Member, and the uniqueness is the
schema's to enforce, which ticket 22 already carries as "Devices keyed per
Member with an editable nickname". The function's contract says so out loud so
nothing stores one globally.

Only `cloud_default` has been seen for the environment type, so the
non-default suffix rule is a reading of the spec rather than something a run
exercised.
