# 163: Usage limits and team budget guides

**What to build:** coordinator, 2026-10-02, overnight while Taha slept: two
more docs guides in the **Costs** section, on search intent the first three
(ticket 151) did not cover: what Claude Code's usage limits are, and how to
budget Claude Code for a team.

**What was decided.**

- `claude-code-usage-limits` and `budget-claude-code-for-a-team`, flat URLs
  after `claude-code-cache-tokens` in the sidebar.
- Every Anthropic figure is cited to its page and was read on 2026-10-02:
  [Manage costs](https://code.claude.com/docs/en/costs), the
  [error reference](https://code.claude.com/docs/en/errors),
  [API rate limits](https://platform.claude.com/docs/en/api/rate-limits), the
  [Enterprise consumption guide](https://support.claude.com/en/articles/14782391-claude-enterprise-consumption-guide),
  [gateway spend limits](https://code.claude.com/docs/en/claude-apps-gateway-spend-limits)
  and the [Pro and Max article](https://support.claude.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan).
- No plan's usage allowance is given as a number: Anthropic does not publish
  one. No SessClone price is written into a guide, and only self-hosting is
  called free.
- SessClone is described as tracking spend, never as enforcing a cap: it has
  no budget or alert feature.
- The team-cost guide links the budget guide, and the cost-per-session guide
  links the limits guide.

**Blocked by:** none

**Status:** done

- [x] Two guides written and linked to the other cost guides, `/docs/compare`, `/docs/install`, `/pricing` and `/sign-up`
- [x] Built locally: each page 200, listed in the sitemap and `/llms.txt`
- [x] Screenshots at 1440x900 and 390x844, light and dark, no horizontal scroll
