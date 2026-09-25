# 132: Transcript viewer reads chunks and tail

**What to build:** The column view (tickets 105 and 108) reads a chunked transcript: the tail first, then earlier chunks as the reader scrolls up, each gunzipped in the browser. Whole-file transcripts read exactly as they do today.

**Where the ask forks, and what was picked.**

- `GET /api/transcripts/<sessionId>` adds `tailOffset` and `chunks: { rawOffset, rawLength, url }[]` to each file, one query with the chunks aggregated per artifact, never a query per file. It signs one presigned GET per chunk, which is local HMAC, not a request. `sizeBytes` stays the raw total.
- One pure planner in `columns.ts`, `earlierRead(file, from)`, replaces `earlierRange` and `rangesToStart`. It returns either a Range read inside the tail object, clamped at `tailOffset`, or one whole chunk. With zero chunks it returns today's ranges byte for byte.
- `data.ts` gains `readChunk`: fetch the chunk whole, pipe it through `DecompressionStream('gzip')`, and renew on 403 as `readBytes` does. `column.tsx` keeps its head-stitching unchanged. A chunk ends on a line end, so its head is always empty, and stitching an empty head does nothing.
- Each chunk's `sha256` rides along in the list too, and `readChunk` checks it after gunzipping, so the viewer and ticket 133's download share one checksum. A renewed link that names a different tail offset, or no longer holds the chunk, fails with "Reload" instead of reading at the wrong offsets. Review fix: a 404 renews like a 403, since a seal deletes the tail it replaced. Review fix: a row counts as chunked only when its key is a `tail-<n>-<nonce>` key with exactly `n` chunk rows (listings, the download route and the file list alike), and the viewer shows a clear error for chunks that do not start at 0, run on without gaps and end at `tailOffset`.
- The Session-start stamp (ticket 106) reads the first chunk when there is one, since byte 0 is no longer in the tail object.
- Agent columns (`readItems`) read every chunk and then the tail, through the same ordered stream ticket 133's download uses (`wholeStream(file)`).
- In-flight chunk fetches abort with the column's existing `AbortController`.

**Blocked by:** 128, 105

**Status:** done

- [x] `columns.test.ts` unit tests for `earlierRead`: zero chunks equals the old ranges, a tail shorter than one read, crossing from the tail into the last chunk, and walking to byte 0
- [x] `data.test.ts`: `readChunk` and `wholeStream` against gzip fixtures in Node, which has `DecompressionStream` natively. Output equals the raw bytes in order.
- [x] Route test against real Postgres: chunks come back in `seq` order, only for rows the viewer may read, and a whole-file row has `chunks: []`
- [ ] A local build with seeded chunked rows and objects in MinIO, screenshots at 1440x900 and 390x844 in light and dark: scroll to the top loads every chunk with no gaps or repeats. No Playwright suite; the logic is proven by unit tests. (Pending: the visual check.)
