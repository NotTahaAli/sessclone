# 146: Search and answer-engine readiness

**What to build:** Taha, 2026-10-01: make sessclone.com as easy as possible
for search engines and AI assistants to read, cite and recommend, at no cost.

**What was decided.**

- Landing JSON-LD gains a `WebSite` node, a `FAQPage` built from the visible
  questions, and `offers` built from the same Tier rows the page renders, so
  prices still live only in the `tiers` table. A "Talk to us" Tier states no
  offer, and neither does the free Self-Hosted Tier, so no $0 plan sits beside
  the hosted ones.
- Every docs page carries `BreadcrumbList` and `TechArticle` JSON-LD.
- `/llms-full.txt` serves every docs page's Markdown in one file, linked from
  `/llms.txt`.
- A docs page compares SessClone with ccusage and Anthropic's own analytics,
  stating only what each project's published docs say. Two questions join the
  landing FAQ: how it differs from those, and what it costs (no figures; the
  pricing page has them).
- IndexNow key file and `apps/web/scripts/indexnow.mjs` to tell Bing and
  Yandex about changed pages after a deploy. Google has no ping; Search
  Console is the way there.

**Blocked by:** none

**Status:** done

- [x] Structured data module with unit tests
- [x] `/llms-full.txt` with tests under the site flags
- [x] Comparison page in the docs
- [x] IndexNow key file and submit script, with a test that the key file matches
