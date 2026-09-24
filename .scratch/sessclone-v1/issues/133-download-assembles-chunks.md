# 133: Download a chunked transcript as one .jsonl

**What to build:** Downloading a chunked transcript still gives the user one plain `.jsonl`. The browser builds it from presigned chunk and tail URLs, and no byte passes through the application.

**Where the ask forks, and what was picked.**

- Zero-chunk rows and sidecars keep ticket 60's link, `/api/logs/download/<id>`, which answers with a 302.
- A chunked row on the Transcripts page and on Session detail renders a small client button instead. It reads the file list (ticket 132's route) and takes `wholeStream(file)`, which yields each chunk decompressed and then the tail.
  - Where `showSaveFilePicker` exists (Chromium), it pipes to the file, streamed with bounded memory.
  - Otherwise it builds `new Response(stream).blob()`, then an object URL, then a click on an `<a download>`, and revokes the URL afterwards. This holds the transcript in memory. The ceiling is stated in the code, and a service-worker stream is the upgrade if it bites.
- The filename is the same as today's: `<session>.jsonl` or `<session>-agent-<id>.jsonl`.
- Each chunk's raw SHA-256 is checked with `crypto.subtle` while streaming. A mismatch aborts with a visible error, never a silently corrupt file.
- `docs/self-hosting.md` and `docs/configuration.md`: a bucket that restricts MIME types must allow `application/gzip`, and the CORS rule for GET is unchanged (ADR 0008).

**Blocked by:** 132

**Status:** todo

- [ ] `wholeStream` and the checksum abort are unit-tested in Node (in 132's `data.test.ts`, not duplicated here)
- [ ] The button's choice between picker and Blob is a small pure function with a unit test
- [ ] Downloaded in local Chromium and in a browser without `showSaveFilePicker` (Firefox or WebKit) from a seeded chunked transcript: the file is byte-identical to the source (`sha256sum`). Screenshots of the button in both themes.
- [ ] Taha downloads a chunked cloud transcript on production
