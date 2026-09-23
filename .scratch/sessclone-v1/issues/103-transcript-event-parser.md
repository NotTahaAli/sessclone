# 103: Transcript event parser

**What to build:** Taha, 2026-09-23: "I want a session transcript viewer, which shows when a subagent started, and a side pane for the subagent transcript in it, if there are multiple depths, keep increasing subpanes. Just like the MacOS finder Columns view, Horizontally Scrollable." The dashboard has never read a transcript's content — `parseTranscript` only reads usage. The viewer needs every line as something it can draw: messages, thinking, tool calls paired with their results, skills, hooks, subagent and workflow spawns, compactions, interrupts, API errors, slash commands. Claude Code calls the format internal, so a line the parser does not know becomes an `unknown` item carrying the raw JSON, never an error.

**Where the ask forks, and what was picked (Taha's picks).**

- **Parsed in the browser**, pure code in `packages/shared/src/transcript/`, so the bytes never pass through the deployment (ADR 0003).
- **Chunk-safe.** The main transcript loads from the end in HTTP Range chunks; pairing a tool result with its call happens over everything loaded, not line by line.
- **Section break** whenever model or effort changes.
- Contract in `packages/shared/src/transcript/types.ts`.

**Blocked by:** —

**Status:** todo

- [ ] `splitChunk`, `parseLines`, `buildTimeline`, `summarizeRun`, `parseJournal`, `parseMeta`, `visibleRows`
- [ ] Synthetic fixtures modelled on real transcripts (a real main session, two Agent runs and a two-agent workflow captured 2026-09-23)
- [ ] Unit tests, each case listed in the fixtures README
