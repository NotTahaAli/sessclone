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

## Results

| Environment   | Unique Turns counted by hand |
| ------------- | ---------------------------- |
|               |                              |
|               |                              |
|               |                              |
| **Total**     |                              |
| **Dashboard** |                              |

## Discrepancies

<!-- Each difference and the cause it was traced to. "Rounding" is not a cause:
     Turns are counted, not rounded. -->
