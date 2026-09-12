# 07: Spike — model switch and multi-iteration turns

**What to build:** An answer: how a mid-session model switch appears in the transcript, and whether a Turn with more than one iteration sums its counters or restates them.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] A model switch performed mid-session and the resulting entries examined
- [x] A Turn with more than one iteration located, or its absence explained
- [x] Findings note states whether the top-level counters remain authoritative
- [x] Any transcript captured is handed to ticket 08

**Answer:** `docs/findings/07-model-switch-and-iterations.md`. `message.model` is
per-entry, and only the `--model` flag moves it — a `/model` command in a
transcript writes no assistant entry and switches nothing. Counters are
independent per iteration, so a Turn is the sum over its distinct `message.id`s,
never a sum over entries. Ticket 08's corpus corrected one conclusion: where
several entries share a `message.id` their usage is not always identical, so the
rule is the maximum of each counter across them, not the first.
