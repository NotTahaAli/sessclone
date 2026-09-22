# Context: sessclone

Glossary for this project. Terms only — no implementation detail, no decisions.
Decisions live in `docs/superpowers/specs/` and `docs/adr/`.

## Core

**Org** — a customer. The boundary for billing, data visibility, and settings.
Every other record belongs to exactly one Org. A solo user is an Org of one.

**Member** — a person inside an Org who runs Claude Code and whose usage is
collected. Members are the billable unit.

**Role** — a Member's authority inside their Org. One of:

- **Owner** — everything, including billing and the subscription, except
  another Member's archival setting.
- **Admin** — the whole Org's data and settings, assigns Scopes, no billing.
- **Manager** — read-only, and only for the Members in their Scope.
- **Member** — sees their own usage only.

A person may set a **display name** for themselves. It is theirs alone to
change, it is one name across the deployment rather than one per Org, and it
leads rather than replaces their address — an address identifies, a name
labels.

**Scope** — the set of Members a Manager may see. Assigned by an Owner or
Admin. An empty Scope sees nobody.

**Platform Admin** — the operator of a sessclone deployment, not a role inside
any Org. Maintains Tiers and Rates and activates subscriptions. Distinct from
Owner: an Owner governs one Org, a Platform Admin governs the deployment.

## Collection

**Device** — one machine or environment a Member runs Claude Code in, as that
Member sees it: a laptop, a server, or the Claude Code Cloud environment. A
Device belongs to one Member; two Members may have Devices with the same name
and they remain distinct. Its **nickname** is display-only and may change; its
identity may not.

**Project** — the codebase a Session ran against, identified by its git remote
where one exists. Its **name** is display-only, one per Project across the Org,
and an Owner's or Admin's to set; the key stays the identity and stays what
spend is grouped on.

**Session** — one Claude Code conversation. A **main Session** is started by a
person; an **Agent Run** is a subagent's Session, belonging to the main Session
that spawned it. A Session may be given a **name**, by the Member whose Session
it is or by an Owner or Admin; it is display-only, as a Device's is.

**Turn** — one model response within a Session, and the atomic unit of
everything sessclone records. A Turn carries the Usage for that response.

**Collector** — the part of sessclone that runs inside a Member's Claude Code
environment, reads Turns, and sends them in. It reports; it never interprets.

## Measurement

**Usage** — the raw counts a Turn consumed: tokens of each kind, thinking
tokens, and server-tool requests. Always as reported; never derived, never
money.

**Rate** — the price of one unit of Usage for one model, valid from a given
date. A Turn is always priced by the Rate that was in force when it ran.

**Cost** — money, and always an _estimate_ derived from Usage and Rates. Never
what anyone was billed. When a Turn's model has no Rate, its Cost is unknown,
which is not the same as zero.

**Reported Cost** — a real cost figure supplied by Claude Code itself rather
than estimated. Currently never available; the term exists so "Cost" is never
read as authoritative.

## Storage and billing

**Log Artifact** — the stored raw transcript of one Session, uploaded only when
the Member has opted in and has not excluded that Session's Project. Distinct
from that Session's Turns, kept separately, and removed on its own schedule.

**Retention** — how long an Org keeps Log Artifacts. Turns are not subject to
it.

**Tier** — a plan an Org subscribes to. Sets the seat price and which
capabilities the Org has.

**Seat** — one billable Member.
