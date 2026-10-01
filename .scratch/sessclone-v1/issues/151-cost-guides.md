# 151: Search-targeted cost guides in the docs

**What to build:** coordinator, 2026-10-01, overnight while Taha slept: two
to four docs guides that answer what people actually search for about Claude
Code cost, accurate to the product and to Anthropic's published prices, so
organic search and answer engines bring readers to sessclone.com.

**What was decided.**

- Three guides, in a new **Costs** section of the docs sidebar:
  `track-claude-code-costs-per-team`, `claude-code-cost-per-session` and
  `claude-code-cache-tokens`. Flat URLs beside the other guides.
- Every Anthropic figure is cited to its page and was read on 2026-10-01:
  the [pricing page](https://platform.claude.com/docs/en/about-claude/pricing),
  [Manage costs](https://code.claude.com/docs/en/costs) and
  [prompt caching](https://code.claude.com/docs/en/prompt-caching). The worked
  example is Anthropic's own `/usage` sample, recomputed by hand.
- No SessClone price is written into a guide: the prices live in the Tier
  table, so the guides link `/pricing`. Nothing implies a free hosted plan;
  only self-hosting is called free.
- The sitemap, `/llms.txt` and `/llms-full.txt` read the docs tree, so the
  guides are listed there with no code change.

**Blocked by:** none

**Status:** done

- [x] Three guides written and linked to each other, `/docs/compare`, `/docs/install` and `/sign-up`
- [x] Built locally: each page 200, listed in the sitemap and `/llms.txt`
- [x] Screenshots at 1440x900 and 390x844, light and dark, no horizontal scroll
