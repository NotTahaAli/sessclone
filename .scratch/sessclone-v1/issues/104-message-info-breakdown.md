# 104: Message info breakdown with cost

**What to build:** Taha, 2026-09-23: "What model and effort each message used … Clicking info icon on message can show exact breakdown. (Tokens, Model, Effort, etc.)"

**Where the ask forks, and what was picked (Taha's picks).**

- Info icon on a model message: model, effort, input, output, cache read and cache write tokens, stop reason, time, and cost.
- Cost comes from Costs, one lookup per Session, joined by message id. Unpriced shows as unpriced, never $0.

**Blocked by:** 100

**Status:** todo

- [ ] `GET /api/transcripts/<sessionId>/costs`, one query
- [ ] Info panel in the viewer
