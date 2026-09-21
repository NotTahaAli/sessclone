-- Ticket 41: the platform price list, seeded.
--
-- Ticket 23 built the tables and left them empty on purpose. This is the seed,
-- and every figure in it was read on 2026-09-21 from
-- https://platform.claude.com/docs/en/about-claude/pricing — the published
-- page, not recall. ADR 0002 is blunt about why: a Cost here is an estimate,
-- and an estimate built on a remembered price is wrong in a way nobody can
-- re-derive. Every row carries that URL and that date in `source`, so a future
-- reader can check the number against the page it came from rather than trust
-- this file.
--
-- The five token classes are spelled out per model rather than derived from
-- base input by the published 1.25x / 2x / 0.1x multipliers. The read
-- multiplier is 0.025x on Claude Fable 5.1 and Claude Mythos 5.1 and 0.1x
-- everywhere else, and a multiplier with exceptions is a price (ADR 0002) —
-- so `cache_read` below is a stored figure on every row, never a computation.
--
-- Scope is the models the page lists as Active, which is the set Claude Code
-- can actually run. The retired rows the pricing page still shows (Opus 4.1,
-- Opus 4, Sonnet 4, Haiku 3.5) are left out: nothing this product ingests can
-- have run on them, and an unpriced model resolves to null, which ADR 0002
-- says is the correct answer rather than a guess. Models older than the 4.6
-- generation are seeded twice, under the dated snapshot id and under the
-- convenience alias, because a Turn records whichever string the client sent
-- and a rate that misses by a suffix is an unpriced Turn.
--
-- `effective_from` is 2026-01-01 on every row, and the read date lives in
-- `source` instead. Those are two different facts: `source` says when the
-- figure was checked, `effective_from` says from when it is claimed to hold.
--
-- Dating the rows the day they were read was the first attempt and it priced
-- nothing: `sessclone_resolve_rate` wants `effective_from <= occurred_at`, so
-- every Turn the product had already collected — the whole fixture corpus —
-- resolved to null, and a price list that prices none of the data is not a
-- price list. Reaching back is defensible here because a rate is keyed by
-- model: a Turn can only name a model that existed when it ran, so a row
-- reaching back before that model shipped is a row nothing can match. The
-- exposure is exactly one case — a model whose published price changed after
-- its launch — and that case is a dated row added above this one, which is
-- what effective dating is for.
--
-- 2026-01-01 rather than a further-back date because it predates every Turn
-- this deployment has collected and is a date somebody can explain.

insert into rates (model, class, price_usd, effective_from, source)
select
  price_list.model,
  token_class.class::rate_class,
  token_class.price,
  date '2026-01-01',
  'https://platform.claude.com/docs/en/about-claude/pricing read 2026-09-21'
from (values
  -- model,                        input,  5m write, 1h write, cache read, output
  ('claude-fable-5-1',                10,    12.50,      20,       0.25,      50),
  ('claude-mythos-5-1',               10,    12.50,      20,       0.25,      50),
  ('claude-fable-5',                  10,    12.50,      20,       1,         50),
  ('claude-mythos-5',                 10,    12.50,      20,       1,         50),
  ('claude-opus-5',                    5,     6.25,      10,       0.50,      25),
  ('claude-opus-4-8',                  5,     6.25,      10,       0.50,      25),
  ('claude-opus-4-7',                  5,     6.25,      10,       0.50,      25),
  ('claude-opus-4-6',                  5,     6.25,      10,       0.50,      25),
  ('claude-opus-4-5-20251101',         5,     6.25,      10,       0.50,      25),
  ('claude-opus-4-5',                  5,     6.25,      10,       0.50,      25),
  ('claude-sonnet-5',                  2,     2.50,       4,       0.20,      10),
  ('claude-sonnet-4-6',                3,     3.75,       6,       0.30,      15),
  ('claude-sonnet-4-5-20250929',       3,     3.75,       6,       0.30,      15),
  ('claude-sonnet-4-5',                3,     3.75,       6,       0.30,      15),
  ('claude-haiku-4-5-20251001',        1,     1.25,       2,       0.10,       5),
  ('claude-haiku-4-5',                 1,     1.25,       2,       0.10,       5)
) as price_list (model, input, cache_write_5m, cache_write_1h, cache_read, output)
-- Unpivoted rather than written out as eighty rows: the shape above is the
-- published table, column for column, so a reviewer can diff it against the
-- page. Adding a class means one entry here, not sixteen edits.
cross join lateral (values
  ('input',          price_list.input),
  ('output',         price_list.output),
  ('cache_write_5m', price_list.cache_write_5m),
  ('cache_write_1h', price_list.cache_write_1h),
  ('cache_read',     price_list.cache_read)
) as token_class (class, price);

-- Server-tool requests, priced per thousand requests rather than per MTok and
-- not per model — the page charges $10 per 1,000 searches whoever answered,
-- so these are the model-independent rows `rates.model is null` exists for.
--
-- Web fetch is free, and is seeded at zero rather than omitted. A missing row
-- and a zero row read the same on the invoice today and completely differently
-- the day it stops being free: one is a migration, the other is a row. ADR
-- 0002 wants the table to be the only place a price lives, and "free" is a
-- price.
insert into rates (model, class, price_usd, effective_from, source)
values
  (null, 'web_search_request', 10, date '2026-01-01',
   'https://platform.claude.com/docs/en/about-claude/pricing read 2026-09-21'),
  (null, 'web_fetch_request', 0, date '2026-01-01',
   'https://platform.claude.com/docs/en/about-claude/pricing read 2026-09-21');
