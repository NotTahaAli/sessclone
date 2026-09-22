# 97: Fetch the latest published pricing, approve each change, apply

**What to build:** A button on the admin Rates page that reads Anthropic's published price list, shows each model whose prices differ from the rates table, and publishes the ones the operator approves. Asked for by Taha on 2026-09-22.

**Where the ask forks, and what was picked.** Taha was shown each choice with a recommendation and left the recommendations standing.

- **Source:** `PRICING_URL`, set to `https://platform.claude.com/docs/en/about-claude/pricing.md` — the page ticket 41 seeded from, in its markdown form. An env var, not a constant, because no external host is compiled into the application; unset, the button says so.
- **Approval unit:** one checkbox per model id, covering all five token classes, because a model's classes change together on the page.
- **Effective date:** a class the model has never been priced for reaches back to the 2026-01-01 epoch, so Turns already collected price (ticket 41's reasoning). A changed price holds from today, so yesterday keeps what it cost.
- **Retired models are skipped**, as the seed skipped them. A dated snapshot id already in the table (`claude-opus-4-5-20251101`) takes its alias's published price.
- **Server-tool rates are not fetched.** The page states them in prose, not a table; they stay a hand-entered row.
- **The browser posts model ids, never prices.** Applying re-reads the page on the server and publishes only the ticked models' changes, so a forged request can at most accept what the page itself published. `rates_write` refuses anyone but the platform administrator independently.

**Blocked by:** 63.

**Status:** done

- [x] "Fetch latest pricing" on `/admin/rates` lists each differing model with old and new price per class
- [x] "Apply ticked" publishes only the ticked models, in one transaction, and says how many prices went in
- [x] A page that changed shape reads as an error, never as "no changes"
- [x] Apply writes a model only when its fresh changes equal what the operator reviewed; a page that changed in between is refused
- [x] A class with a future-dated row is left alone; a name that is not a plain model id, or a repeated one, fails the fetch
- [x] Tests against Postgres: parse the page rows verbatim, propose epoch for a new model and today for a change, apply as the operator, refused as an Org Owner with nothing written
- [x] No migration: it writes the existing `rates` table
- [x] Looked at on production by Taha, who confirmed it works (2026-09-22). No screenshots: this container has no Supabase session, so no admin page can be driven here
