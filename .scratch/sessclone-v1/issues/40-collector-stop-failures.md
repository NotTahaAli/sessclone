# 40: Collector — stop failures

**What to build:** When a session dies on a rate limit or an overload, that fact is recorded — the question a subscription user actually has. Extends the route test suite.

**Blocked by:** 33.

**Status:** ready-for-agent

- [ ] Failure type and message recorded against the Session
- [ ] Route accepts the event through the same key verification as Turns
- [ ] Table ships with its policies, and they are covered by the policy suite
