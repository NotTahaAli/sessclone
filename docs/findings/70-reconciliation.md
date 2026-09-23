# 70 — Manual verification: dedup and reconciliation

The final check that the numbers are true: one Member reporting from at least
three environments at once, repeated sweeps and restarts producing no duplicate
Turns, and a dashboard total that matches a hand count of the transcripts for
one day.

## The hand count

```
node scripts/verify-collector.mjs --reconcile --day 2026-09-22 --tz <the Org's timezone>
```

Run it on each machine that reported that day and add the **unique** figures
together; that sum is what the dashboard's total for the day should equal.

Three things about that number:

- **Unique, not parsed.** `turns_identity_key` is
  `(member_id, session_id, agent_id, message_id)` with `nulls not distinct`, so
  a Turn reported twice is one row. The script counts the same way and prints
  both figures; `parsed − unique` is what the index absorbed.
- **The timezone is the Org's, not the machine's.** The dashboard's day comes
  from the Org's timezone (ticket 51). Counting in one zone and comparing
  against a dashboard in another manufactures a discrepancy with no cause
  behind it. Set `--tz` to the Org's.
- **Subagent transcripts are included.** They sit one and sometimes two
  directories below the Session (finding 74); the reconciliation walks the whole
  tree rather than the one level the sweep lists.

Turns with no timestamp cannot be placed in a day and are counted separately
rather than folded in. Turns cut off mid-stream are counted, and their token
figures are a floor.

## Count the Session, not the Device

Finding 69 changes what this reconciliation can compare. In the cloud every
container reports under one `cloud:<account uuid>` Device key, and a container's
transcripts die with it — so a Device total covers machines whose transcripts
can never be counted by hand, and will always read higher than any single hand
count. The Session is named identically on both sides and is the only unit a
difference can be traced in, so the hand count now prints one row per Session
(`### By Session`) as well as the total.

## Results

Counted on 2026-09-22, Org timezone `UTC` (read from `orgs.timezone`, which is
what ticket 51's day boundary uses).

| Environment                                | Unique Turns counted by hand | Dashboard |
| ------------------------------------------ | ---------------------------- | --------- |
| Claude Projects container, Session `fd21…` | 977                          | 950       |
| macOS, `host:<laptop-hostname>.local`      | 15                           | 15        |
| Other containers, same Device key          | not countable (see below)    | 561       |
| **Deployment, all time**                   | —                            | **6,833** |

Every figure above is a reading at an instant, because the session doing the
counting is itself producing Turns: the container's Session stood at 950 on the
dashboard at 10:16:32Z and 983 at 10:20:58Z. The Device's own total for the day
is the sum of the two container rows — 983 + 561 = 1,544 — and the hand count
below is paired with the dashboard reading taken at the same moment.

### The one difference, and its cause

The container's own Session read 977 Turns by hand against 950 on the
dashboard. The 27 are not missing: **every one of them was written after the
last Turn the deployment had received**, which is what a Collector that flushes
at a turn boundary is supposed to look like while a session is still running.

Traced rather than assumed. The deployment's newest Turn for that Session had
`occurred_at` 10:16:27.989Z; splitting the hand count on that exact instant
gives 950 at or before it and 27 after, with the earliest of the 27 at
10:16:41.867Z:

```
{ "total": 977, "atOrBefore": 950, "after": 27,
  "earliestAfter": "2026-09-22T10:16:41.867Z" }
```

950 and 950. The difference is a moving window, not a loss — a reconciliation
run against a live session counts Turns the deployment has not been offered
yet. Count a finished session, or subtract what falls after the newest
`received_at`.

The other containers' 561 Turns cannot be hand-counted at all: those containers
are gone and took their transcripts with them. That is finding 69's sixth
reading stated as an accounting fact rather than a loss scenario, and it is the
reason the Device is the wrong row to reconcile on.

## Repeated sweeps produce no duplicates

Forced rather than waited for. Every cursor in this container's state directory
was moved aside — 42 of them — and `hooks/session-start.mjs` run, which is the
sweep: with no cursor to resume from it re-read each transcript from byte zero
and re-sent every Turn it found, including ones the deployment had already
stored.

|                                     | Before the re-sweep | After |
| ----------------------------------- | ------------------- | ----- |
| Turns in the deployment             | 6,800               | 6,833 |
| Identities appearing more than once | 0                   | 0     |

The 33 new rows are the Turns this session wrote in between; not one re-sent
Turn became a second row. `turns_identity_key` is
`(member_id, session_id, agent_id, message_id)` with `nulls not distinct`, and
the ingest path upserts on it, so a resend is absorbed rather than counted —
checkbox two, demonstrated on a live deployment rather than argued from the
schema.

Also checked across all 6,833 Turns: **no Turn is stored under two Projects.**
A cloud Session spans two Project keys (finding 69) — `local:vm:/home/user`
then the repository — but each individual Turn lands under exactly one of them.
The split divides a Session's Turns; it does not duplicate any.

## Three environments at once

Three environments of the same Member reported inside one window on
2026-09-22, between 10:00Z and 10:41Z:

| Environment                  | Device key                     | Session      | Turns in the window        |
| ---------------------------- | ------------------------------ | ------------ | -------------------------- |
| Claude Projects, container A | `cloud:<account-uuid>`         | `fd211903-…` | 67, 10:01:03Z to 10:28:25Z |
| Claude Projects, container B | `cloud:<account-uuid>`         | `e61f7535-…` | 9, 10:00:12Z to 10:41:18Z  |
| macOS                        | `host:<laptop-hostname>.local` | `faa17eb1-…` | 1, at 10:22:19Z            |

Three machines, **two** Device rows, because the two containers are one Device
by design — the account outlives the container, so a `cloud:` key names the
account and not the machine. Nothing merged across them: each Session's Turns
stayed under its own Session, and the Mac's stayed under the `host:` Device.

The Mac's own hand count, run by its operator, is the clean case the container
could not be:

```
| Transcripts read | 727 |
| Turns in window | 15 |
| **Unique Turns — compare this with the dashboard** | **15** |
| Repeats collapsed by identity | 0 |
```

The dashboard holds **15** Turns for that Device on that day, across 11
Sessions. Fifteen and fifteen, with nothing to explain — because that hand
count was taken between sessions rather than inside a live one, which is
exactly the difference the container's 977-against-950 reading measured.

727 transcripts read against 11 Sessions that day is not a discrepancy: the
count walks every transcript the machine has ever written and then keeps only
the Turns that fall in the day.
