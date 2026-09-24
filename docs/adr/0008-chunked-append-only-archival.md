# 0008 — A growing transcript is archived as sealed gzip chunks plus a raw tail

**Status:** proposed · 2026-09-24 · Taha's decision · tickets 128–133

Refines ADR 0003's "one object per Session, replaced as it grows". It keeps
all of ADR 0003's other rules: the bytes never pass through the application,
the presign guards come before the bytes move, and only S3 APIs are used.

## Context

ADR 0003 stores one object per transcript and replaces it on each upload.
That was cheap when uploads ran at `SessionEnd` and in the `SessionStart`
sweep (ticket 59). Ticket 99 made cloud containers upload after every turn,
so an 18 MB session now re-sends 18 MB per turn, and a resumed laptop session
re-sends its whole history at the next `SessionEnd`.

Transcripts are append-only. Finding 04 measured this across a compaction, and
finding 74 across a lost container: the file kept growing after the gap, and
the Collector's state directory did not survive. So a cursor kept only on the
machine can be lost while the transcript it points into lives on.

The viewer (tickets 105–108) reads the main transcript backwards from the end,
in 1 MiB HTTP Range reads against a presigned GET. The download (ticket 60) is
a 302 to a presigned GET.

## Decision

**A transcript is a run of sealed chunks followed by one tail.**

- A **chunk** holds about 1 MiB of raw transcript. It is cut at the first line
  end at or after 1 MiB, so one line longer than that makes a longer chunk. It
  is gzipped once and stored as an immutable object. Its row records the raw
  offset, the raw length, the stored (compressed) size and the SHA-256 of its
  raw bytes.
- The **tail** is every byte after the last chunk, stored raw. It is
  overwritten on each upload, as the whole object is today.
- The Collector sends only bytes past the sealed prefix. A turn that seals
  nothing uploads the tail alone, which is under about 1 MiB and usually much
  less.

**Whole-file is the zero-chunk case, not a second layout.** When a transcript
has no chunks, its tail starts at byte 0 and lives at ADR 0003's key
`…/<session>.jsonl`. That is exactly today's object. Every existing row, and
every older Collector, is already valid under this model, so nothing is
backfilled.

**Keys.** Chunks and tails sit in the Session's own directory, beside the
`agents/` and `workflows/` entries from ticket 104:

```
…/<session>.jsonl                               tail with 0 chunks (= today)
…/<session>/chunks/<seq>-<hash>.jsonl.gz        chunk <seq>, zero-padded to 6
…/<session>/tail-<n>-<nonce>.jsonl              tail after <n> chunks, n ≥ 1
…/<session>/agents/<agent>.jsonl                an Agent Run, same rules below it:
…/<session>/agents/<agent>/chunks/<seq>-<hash>.jsonl.gz
…/<session>/agents/<agent>/tail-<n>-<nonce>.jsonl
```

**No key is reused for different bytes.** A key is deleted only once no
row names it (the replaced-key cleanup, the orphan sweep), so a key that
came back into use after it was queued for deletion would lose the bytes a
row now points at. So a chunk key carries `<hash>`, the first 16 hex of the
chunk's raw SHA-256: different bytes never share a key, and the same bytes
resealed land on the same key harmlessly. A tail key carries `<nonce>`, 64
random bits the presign draws for each pass, so no two passes share a tail
key. Only the zero-chunk key `…/<session>.jsonl` is reused, as ADR 0003
always reused it; the orphan sweep skips any queued key a row names again,
and a confirm takes the keys it records out of `storage_orphans`.

The tail is keyed by how many chunks come before it, so sealing moves it to a
new key. The confirm swaps the row's chunk set and its `storage_key` in one
transaction, and the old tail is deleted only after that commits (the
replaced-key cleanup ticket 59 already does). A reader therefore sees either
the old set or the new set, never a tail that overlaps or leaves a gap after
the chunks. The confirm serialises on the transcript's identity with a
transaction-scoped advisory lock rather than a row lock, because a first
upload has no row to lock. A whole-file confirm deletes the chunk rows in
that same transaction, just before its upsert. With one fixed tail key, the
tail PUT would land before the confirm, and every reader in that window
would see a gap or a duplicate.

**The server holds the cursor.** The artifact row records `sealed_bytes` and
`sealed_sha256`, the SHA-256 of the raw bytes `[0, sealed_bytes)`. The presign
answer returns both. The Collector re-hashes that prefix locally, which reads
local disk and sends nothing, and compares. If the prefix matches, it
continues from `sealed_bytes`. If it does not, or the file is now shorter than
`sealed_bytes`, the file was rewritten or truncated, so the Collector falls
back to a whole-file upload. Any local state the Collector keeps is a cache,
as `archived/` already is, because finding 74 shows local state is lost while
the transcript continues.

**Failsafe: whole-file.** The Collector falls back when the prefix does not
match, when compression fails, or when the deployment does not answer
`layout: 'chunked'`. It presigns with `layout: 'whole'` and PUTs the whole
file to `…/<session>.jsonl`. The confirm then drops every chunk row, and the
chunk objects and old tail go after the commit. A later pass may start
chunking again from byte 0.

**Only `kind = 'transcript'` chunks.** An `agent_meta` sidecar is small JSON
that gets rewritten. A `workflow_journal` is small. Both stay whole.

**The unchanged guard stays whole-file.** `sha256` on the row is still the
hash of every raw byte stored. The presign still refuses `unchanged` on a
match, and the Collector still settles that locally. Each chunk also carries
its own raw SHA-256, which a reader may check after decompressing.

### The contract (`packages/shared/src/presign.ts`)

Every change is additive, and every new field is optional or defaulted.

- `PresignRequest.layout`: `'whole' | 'chunked'`, defaulting to `'whole'`.
  Collectors that predate this send nothing and get today's behaviour.
- `PresignRequest.seal`: the chunks this pass will seal, as the Collector
  planned them, 1 to 16 of `{ seq, sha256 }` (lowercase hex), only with
  `chunked`. It asks for one chunk PUT URL each, starting at the next seq
  and keyed by that chunk's hash, and for the tail URL after them. A presign
  without `seal` is the steady-state turn: one tail URL at the current seq,
  with a fresh nonce.
- The allowed `PresignResponse`, when `layout` was `chunked`, gains
  `layout: 'chunked'`, `sealed: { bytes, sha256 | null, chunks }` and
  `seals?: { seq, url, storageKey }[]`. `url`/`storageKey` are the tail's.
  A deployment that predates this strips `layout` and omits these fields,
  and so does this one for any kind other than `transcript`. The
  Collector treats a missing echo the way ticket 104 treats a missing `kind`:
  it uses the whole-file path.
- `ConfirmRequest.layout` is defaulted the same way.
  `ConfirmRequest.chunks?` lists the chunks this pass sealed as
  `{ seq, rawOffset, rawLength, sha256 }`, and `ConfirmRequest.sealedSha256?`
  is the new cumulative prefix hash. `storageKey` stays the tail key that was
  PUT to.
- New transient refusal: `stale_chunks`. The first new chunk does not start at
  the row's `sealed_bytes` or seq, the seqs are not contiguous, or the
  echoed tail key is not a tail after `chunks + seal` chunks. The Collector
  presigns again. The confirm looks each chunk up under the key its
  `sha256` addresses, so a chunk confirmed with other bytes than it was
  presigned for is `not_uploaded`.
- A confirm with `layout: 'whole'`, including every older Collector's, clears
  the row's chunks. Without that, a downgraded Collector's whole file would be
  read after stale chunks as a duplicate.

A steady-state turn is one presign, one PUT of the tail and one confirm, the
same three requests as today. A sealing turn is one more presign. The confirm
reads each new chunk's stored size and the tail's raw size back from storage
with a HEAD, at most 17 of them. It trusts no size the Collector reports, as
ADR 0003 has it. The raw offsets and lengths are the Collector's word, as the
SHA-256 already is: a Member who lies about them corrupts only their own
transcript. They are bounded all the same, because they become `size_bytes`:
the contract caps `rawLength` at 256 MiB and `rawOffset` below 2^50, and the
confirm refuses a chunk whose `rawLength` exceeds its HEAD-read stored size
times 1032, deflate's worst-case expansion. Within those bounds a lying
Collector can still overstate its own `size_bytes`, and so the usage the
transcripts page reports for it; that is left as is, since it misstates only
that Member's own storage.

### The schema

A new table, `log_artifact_chunks (artifact_id, seq, raw_offset, raw_length,
stored_bytes, sha256, storage_key, member_id)`. Its RLS policies ship in the
same migration and mirror `log_artifacts`: read for
`sessclone_visible_member_ids()`, delete for `sessclone_own_member_ids()`, and
no insert or update policy. `member_id` is denormalised so each policy is one
indexed membership check, not a join, and the foreign key is
`(artifact_id, member_id)` onto `log_artifacts (id, member_id)`, so the copy
cannot disagree with its artifact. That key is
**`on delete no action`**, not `cascade`. A cascade would
delete the chunk rows silently and lose the keys of objects that still hold
source code. With `no action`, a delete path that forgets the chunks fails
loudly. The paths that remember them delete chunks and artifact in one
statement, through data-modifying CTEs whose `returning` gathers every key.

`log_artifacts` gains `sealed_bytes bigint not null default 0` and
`sealed_sha256 text`. `size_bytes` keeps its meaning: the raw bytes of the
transcript, which is what a download yields and what the viewer's offsets
count. What the bucket holds is `sum(stored_bytes)` plus the tail.

A second table, `log_upload_pending (storage_key, member_id, session_id,
agent_id, kind, project_id, expires_at)`, holds the keys a presign signed
that no confirm has recorded yet (see Consequences). It has read and delete
policies for `sessclone_own_member_ids()` and no insert or update policy.

### Readers

- **Viewer.** The file list gains `tailOffset` and
  `chunks: { rawOffset, rawLength, url }[]`, each chunk with a presigned GET. One pure planner maps
  "the next earlier piece before raw byte `from`" onto either a Range read
  inside the tail object or one whole chunk. A chunk is fetched whole and
  gunzipped with `DecompressionStream('gzip')`. The backwards model and the
  line stitching from tickets 105 and 108 do not change. With zero chunks the
  planner produces exactly today's range reads.
- **Download.** A zero-chunk artifact keeps ticket 60's 302. A chunked one is
  assembled in the browser as one `ReadableStream`: each chunk in order,
  decompressed, then the tail. It is piped to `showSaveFilePicker` where that
  API exists, and collected into a `Blob` behind an object URL where it does
  not. The user always gets a plain `.jsonl`, and no byte passes through the
  application.
- **Retention, per-Session delete, per-Project delete, and confirm's
  replace/fallback** all delete the chunk rows in the same statement as their
  artifact, and send the chunk keys to `deleteObjects` with the tail key.

### Storage quirks carried forward

The chunk and tail keys are built only from `segment()` output, digits,
lowercase hex and literal path text, so no `%` can appear in them (the Supabase `InvalidKey` trap). A
chunk is PUT as `application/gzip` with no `Content-Encoding`. Setting that
header would make browsers and some providers decode the object in transit,
and whether they do varies by provider. A Supabase bucket that restricts
allowed MIME types must allow `application/gzip`. Chunk GETs send no `Range`
header, so the CORS rule from ticket 104 covers them unchanged. Presigned URLs
keep the existing TTL and the existing renew-on-403 in `readBytes`, which
renews on a 404 as well: a seal deletes the tail it replaced, so a list read
before it names an object that is gone. The download's stream then carries
on from the new list's chunks at the old tail's offset, because the file is
append-only; the viewer's Range reads inside the tail still ask to reload.

## Alternatives rejected

- **Keep one whole object (as is).** Costs bandwidth that grows with session
  length on every turn in the cloud. It is the problem this ADR solves.
- **Gzip the whole file as one object.** It shrinks the bytes, but it still
  re-sends everything each turn, and a gzip stream cannot be Range-read from
  its end. The viewer would have to download and inflate the whole transcript
  before it showed the last line.
- **One object per turn.** Tiny objects, one PUT and one row each: thousands
  of requests and rows for a long session, a list of thousands of URLs for the
  viewer, and far more per-object cost than bandwidth saved.
- **S3 multipart upload or server-side compose.** It needs a 5 MiB minimum
  part and an upload left open across turns, and Supabase Storage's S3 layer
  does not support all of it. It also stays a single object that cannot be
  Range-read once compressed.
- **A fixed tail key.** Rejected above: a reader can see a gap or a duplicate
  between the PUT and the confirm.
- **A cursor held only by the Collector.** Finding 74: the state directory
  dies while the transcript lives on.

## Consequences

- A steady-state cloud turn sends a tail of under about 1 MiB plus two small
  requests, not the whole session. Stored bytes shrink by roughly the gzip
  ratio of JSONL, which is several times.
- Each pass hashes the file locally twice, once for the unchanged guard and
  once for the prefix check. That is local disk reading at hundreds of MB/s.
  It becomes worth optimising only if measured.
- **Unconfirmed uploads have a delete path.** A pass can PUT objects that no
  row ever names: one cut off by its deadline or a crash, one that loses a
  race (`stale_chunks`), one refused at the confirm, one whose Session is
  deleted between the PUT and the confirm, and one whose confirm is
  `unchanged`. Because every pass now writes new keys, this is not the
  whole-file path's orphan, which the next upload overwrote. So the presign
  records every key it signs in `log_upload_pending` (the Member, the
  Session and Project, and an expiry of the URL's life plus an hour) before
  it answers. The confirm deletes the keys it records from that ledger in
  its transaction, and refuses as `not_uploaded` if any is no longer there.
  A confirm that ends any other way moves that pass's pending keys into
  `storage_orphans`. The retention sweep moves expired entries there too,
  and deletes an orphan only while no artifact row, chunk row or pending
  entry names its key. A Member's own per-Session and per-Project deletes
  take the pending keys under what they destroy. The ledger has RLS: the
  Member may read and delete their own rows, and only the presign writes.
- A Session that moves Project changes its key prefix, so its chunks start
  again from zero under the new prefix. The old chunks go with the replaced
  row, through the existing `stale_key` and replaced-key path.
- The viewer's file list grows by one presigned URL per MiB of transcript,
  about 600 bytes each. A 500 MB transcript is about 300 KB of list. If that
  is measured to matter, the upgrade is paging the chunk list.
- The Blob fallback holds the whole raw transcript in browser memory.
  Chromium-based browsers stream through `showSaveFilePicker` and avoid this.
