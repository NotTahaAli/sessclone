# 0004 — Billing is modelled before a payment rail exists

**Status:** accepted · 2026-09-12 · ticket 13

## Context

v1 ships without payment collection. No rail is chosen — Stripe, Polar, Paddle,
Lemon Squeezy and JazzCash are all still open, and the choice depends on facts
this project does not have yet.

The temptation in that position is to build a payment abstraction so the choice
stays cheap. An interface with no implementation behind it is designed against
an imagined provider, and the real one never fits it.

## Decision

v1 models plans, subscriptions, and seat limits, and enforces them. A platform
admin activates an Org by hand once payment arrives out of band.

**The extensibility is carried by the schema, not by code.** A subscription row
records:

- `provider` — `manual` in v1;
- `provider_customer_id` — nullable;
- `provider_subscription_id` — nullable;
- `provider_metadata jsonb` — nullable.

**Every activation writes a `subscription_events` row, manual included.** The
manual path is not a special case that skips the audit trail; it is the first
implementation of it. When a real provider arrives, its webhook writes the same
rows, and the history before and after is one series.

Entitlement checks read only the subscription's status and its Tier. They never
read `provider`. That is what makes adding a rail a new webhook route rather
than a rewrite: no migration, no change to any check.

Tiers gate three things in v1 — included and maximum seats, whether transcript
upload is available at all, and the retention ceiling — with further gates in
`features jsonb` so the next one is a data change rather than a migration.

**No adapter interface is built until a real provider shapes it.** When the
second provider arrives and the two disagree, that disagreement is the
specification for the abstraction. Writing it now would be writing it from
imagination.

## Consequences

Activation is manual, so an Org waits on a human. At v1 volume that is a person
clicking a button, and the seat and Tier enforcement around it is real code
that a provider will not change.

The nullable provider columns look like dead weight until a rail lands. They
are the reason landing one is not a migration.
