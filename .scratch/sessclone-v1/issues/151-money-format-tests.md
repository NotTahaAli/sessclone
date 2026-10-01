# 151: Unit tests for the money and count formatters

**Good first issue.** Pure functions, one new test file, no database.

**What to build:** `apps/web/lib/money.ts` formats every dollar figure and
token count the dashboard shows (`usd`, `count`, `compact`), and its header
states a rule that matters: a sub-cent Turn shows its real digits, never
`$0.00`. No test pins that rule today, so a refactor could break it silently.

**Blocked by:** none

**Status:** todo

- [ ] `apps/web/test/money.test.ts` covers `usd(null)`, zero, the 0.005
      boundary between six decimals and two, a micro-dollar amount, a
      negative amount, and a large amount
- [ ] `count` and `compact` each get a thousands case and a millions case
- [ ] Expected strings come from running the code, not from memory: `Intl`
      output depends on the runtime
- [ ] `pnpm test` passes
