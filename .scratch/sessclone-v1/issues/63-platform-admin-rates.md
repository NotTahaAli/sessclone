# 63: Platform admin — rates

**What to build:** The operator keeps prices current and finds out when a model appears that nobody has priced.

**Blocked by:** 41, 43, 62.

**Status:** done

- [x] Rates viewable, publishable and deletable, with effective dates — never edited in place, because a Rate prices the Turns of its own days (ADR 0002)
- [x] Unknown model identifiers seen in Turns listed, with how many Turns each affects
- [x] Adding the missing rate fills in the affected history
- [x] A price change is recorded as a new effective-dated row, never an overwrite
