# 29: Transcript parser

**What to build:** The function that turns a transcript into Turns — the single place the counting can go wrong, and where the measured overcount is prevented.

**Blocked by:** 01, 08, 09.

**Status:** done

- [x] One Turn per model response, not per content block
- [x] Entries without Usage ignored, keyed on absence of Usage rather than a list of types
- [x] Cache creation kept split; thinking tokens and server-tool counters carried
- [x] Model and every pricing modifier carried onto the Turn
- [x] Agent Run transcripts parsed the same way, attributed to their parent Session
- [x] Runs against the committed fixture corpus, including compaction and model-switch fixtures

**Answer:** `packages/shared/src/turns.ts` exports `parseTranscript(text)`,
which yields one `Turn` per `message.id` in first-appearance order. Across the
eleven committed fixtures, 35 usage-bearing entries collapse to 19 Turns —
which is the 2.4x overcount, not happening.

Three rules carry the money, and each one has a fixture or a constructed case
behind it. Counters are the **maximum** across the entries sharing an id, so
the group where `apiBlockIndex` 0 reports 1 output token against block 1's 202
is billed at 202. A group whose entries all carry `stop_reason: null` is
`complete: false` — its maximum is a floor, and the corpus holds two of them.
And cache creation keeps its 5-minute and 1-hour classes apart.

Two things changed after a fresh-eyes review, and both were bugs a reader
would have to construct to see, because every block in the corpus agrees with
its siblings:

- **The two cache-creation classes are read from the same entry as the total
  they explain.** Maximising the three counters independently composes a usage
  block no entry ever reported: blocks that disagree about which class the
  tokens fell in yield 20,330 five-minute tokens beside 24,982 one-hour tokens
  against a reported total of 24,982 — an 81% overbill of the most expensive
  class.
- **A pricing modifier is read from a block that finished.** `apiBlockIndex` 0
  is the partial write the counters already refuse to believe, and it is
  missing `speed` outright on one measured turn; taking `service_tier` from it
  would price a Turn at a tier the completed response did not use.

Counters are also coerced: anything that is not a non-negative safe integer is
read as absent. `1e999` is a number JSON accepts and JavaScript cannot hold, and
it serialises back out as `null`, which prices nothing at all.

**One deviation from finding 05, stated deliberately.** That finding's recovery
rule is "truncate to the last newline, parse that, discard the remainder". The
parser instead tests the tail by whether it parses. A torn entry is a prefix of
a JSON object, so it never parses and is dropped either way — but truncating
also drops a _complete_ final entry whose newline has not landed, and on a
transcript that never grows again that Turn is lost for good. Same protection,
one fewer loss.

**Handed on rather than solved here:**

- A group split across two cursor reads — block 0 in one, block 1 in the next —
  produces a Turn at its floor, and `ON CONFLICT DO NOTHING` keeps the floor.
  That is the 200x undercount re-entering through ingest rather than the
  parser. Tickets 31 and 37 own it; nothing on a `Turn` currently distinguishes
  "may still complete" from "died mid-stream".
- `parseTranscript` takes the whole text. The Collector reads a delta from its
  cursor, so that is the right shape for the hot path, but a `SessionStart`
  sweep re-reading a whole Session holds the file in memory. Ticket 37 should
  decide whether the signature becomes an iterator.
- No fixture carries a non-zero `web_search_requests` or `web_fetch_requests`,
  so those counters are proven against a constructed entry rather than a
  captured one. Ticket 08 is where a fixture would come from.
