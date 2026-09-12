# 05: Spike — killed container

**What to build:** An answer: does a forcibly reclaimed environment fire `SessionEnd` at all, and what is left unreported when it does not.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] A container killed rather than exited cleanly, and the hook firings observed
- [x] Findings note states what the sweep must recover and what is unrecoverable
- [x] The documented residual gap is either confirmed or narrowed

**Partially done — stays open.** `docs/findings/05-killed-process.md` covers what
a cloud container can reach: SIGTERM fires `SessionEnd`, SIGKILL fires nothing,
and neither matters, because an in-flight turn is not streamed to the jsonl at
all. It is written in one step when it completes, so a session killed mid-turn
loses the whole turn under either signal and `SessionEnd` buys a notification
rather than data. No torn records were produced.

Still untested, and the reason the first criterion is unticked: a true container
reclaim. Specifically whether the transcript is readable afterwards at all,
whether unflushed page cache is lost (the one way a torn record could still
appear), whether the platform signals before reclaiming, and interactive
multi-turn sessions. Needs an environment someone can actually reclaim, and
hooks logging to an HTTP endpoint rather than to a local file.
