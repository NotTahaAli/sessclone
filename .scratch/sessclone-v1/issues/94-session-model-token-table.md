# 94: The per-model figures as a table of token classes

**What to build:** The Models section of a Session's detail as a table, asked for by Taha on 2026-09-22, with a column per token class: model, input, output, cache read, cache write.

Ticket 89 put per-model spend on the page as one total token figure and a cost. That answers "what did the Opus part cost" and not "why" — and the why is almost always the cache, which is the difference between a session that reread its context and one that did not.

**Where the ask forks, and what was picked.**

- **Cache write is the reported total, one column.** `cache_creation_5m_input_tokens` and `cache_creation_1h_input_tokens` are subsets of `cache_creation_input_tokens`, so a column each beside the total would count a token twice on any reader's mental sum. The split matters to pricing and is already where pricing happens.
- **The four columns add up to the token figure ticket 89 showed,** which is the same rule `dailySpend` and `breakdown` follow: the four reported classes, thinking not added because it is a subset of output.
- **Cost stays on the row.** It is the column a reader came for, and dropping it to fit the four new ones would answer a narrower question than the page answered yesterday.
- **A real table, scrolling sideways on a phone.** Six columns do not stack into anything readable at 390px, and a per-row card of six labelled figures is what the reader is trying to get away from. The model column leads, so what scrolls out of view is the figures rather than the row's identity.

**Blocked by:** 89.

**Status:** done

- [x] `sessionModels` returns the four token classes separately rather than summed
- [x] A table on a Session's detail: model, input, output, cache read, cache write, cost
- [x] The four columns sum to the token total the same Session's summary shows
- [x] A model with nothing priced shows an em dash and its unpriced count, never `$0.00`
- [x] Looked at on production by Taha, who confirmed all three work. No screenshots: the container this was built in had no Supabase session and no Docker for a local stack, so no signed-in page could be driven in it
