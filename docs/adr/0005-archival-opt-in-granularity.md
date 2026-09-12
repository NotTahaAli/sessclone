# 0005 — Archival opt-in is per Member, then per Project

**Status:** accepted · 2026-09-12 · ticket 14

## Context

The spec contradicted itself. The glossary, the ingest rule, the risk register
and design §6 all made transcript archival a Member-level choice. User story 30
promised a per-machine one: _"As a Member, I want to turn archival on per
machine, so that I can archive work sessions and not personal ones."_

Ticket 14 framed this as either/or. It is not. Story 29 states a **default**
(off until I decide) and story 30 states a **granularity** — they coexist.

The harder problem is that story 30's granularity does not deliver story 30's
reason. Work and personal sessions routinely share one laptop. Per-Device
separates them only for a Member who keeps separate machines, which is not the
common setup. The thing that actually separates work from personal is the
**Project** — already a first-class term, already identified by git remote.

## Decision

**A master switch per Member, off by default. Within it, a per-Project
setting.**

- Nothing leaves a machine until the Member turns the master switch on. An
  Admin cannot turn it on for them; this is the one place in the model where an
  Admin is not a superset of a Member.
- **A Project not yet toggled inherits the master switch.** The per-Project
  setting is an opt-out list, not an allow list. Chosen for friction: a member
  who turned archival on means it, and asking them to visit the dashboard for
  every new repository would lose the archives they wanted.
  - **Accepted tradeoff, deliberately:** a personal repository is archived
    until the member excludes it. That is a real weakening of story 30's
    intent, taken with eyes open, because an allow list silently archives
    nothing and members discover the gap when they go looking for a transcript
    that was never uploaded.
- **A working directory with no git remote keys as
  `local:<hostname>:<absolute path>`.** Local-only work stays archivable and
  stays togglable. This replaces the design spec's earlier
  `local:<hostname>:<basename>`, which merged `/work/api` and `/personal/api`
  on one machine into one Project — exactly the separation this decision is
  for.
  - The hostname is what makes the key per-machine. An absolute path alone is
    not: `/home/user/api` is byte-identical on two laptops, so a toggle on one
    would authorise an upload from the other.
  - The path is stored as the Project key, so it is Org-visible to anyone who
    may see that Member's Projects. Members who consider their directory
    layout sensitive have the master switch.

**Turning archival off is forward-only.** It stops new uploads and leaves what
is already stored, which then ages out under Retention. Deletion is a separate,
explicit action, because the two intentions are different: _stop collecting_
and _destroy what you hold_ should not be the same click, in either direction.

- A Member may delete their own Log Artifacts explicitly, at Member or Project
  granularity. The Project-shaped object key of ADR 0003 makes that a prefix
  sweep.

**Enforcement is server-side, at the presign route.** The Collector runs on the
Member's machine and is not trusted to enforce anything about itself. The route
resolves the Session to its Project from the Turns already ingested — never
from the Project the request claims — reads the master switch and the Project
setting, and refuses.

Master-switch-off and Project-excluded are **separate** refusals, not one: a
member told only "archival is not enabled" cannot tell which switch to flip.
Both are distinguishable from a Tier refusal and an unchanged-hash refusal
(ADR 0003).

A Session with no ingested Turns yet has no resolvable Project. That refuses
too, with its own reason — transient, and retried by the Collector on the next
opportunity rather than reported to the member.

**Where the flag lives.** A boolean on `members` for the master switch, and a
per-`(member, project)` row for the exception. Both are written by the Member
and readable by those a Role permits; no Role may write another Member's
setting. The policies ship in the same migration as the columns, per ADR 0001 —
so `members` gains the boolean in ticket 21's migration, not a later one, and
the exception table lands in ticket 22's alongside `projects`.

## Consequences

The glossary's "uploaded only when the Member has opted in" and user story 30's
"per machine" are both updated in this change, to Member-then-Project.

`CONTEXT.md` gains no new term. Project already means "the codebase a Session
ran against"; this decision gives it a second job rather than inventing a
fourth granularity.

Tickets 21 and 22 are both now blocked by this ADR: `members` carries the
master switch, and the exception table belongs beside `projects`.

The design spec's non-git Project key and the v1 spec's copy of it are both
corrected to carry the absolute path.

Neither control this decision assumes existed in the plan. Ticket 72 builds the
settings surface — master switch and per-Project exclusions — and ticket 73
builds artifact deletion. Ticket 59 is now blocked by 72, because "nothing
uploads until the Member turns it on" needs something to turn on. User story 31
records the deletion case the forward-only opt-out does not cover.

An Org Owner cannot archive an Org's work by decree. That is the intended
shape: Log Artifacts hold source code and sometimes credentials, and the
person who ran the session decides whether they leave the machine.
