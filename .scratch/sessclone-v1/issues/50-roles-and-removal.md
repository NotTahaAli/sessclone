# 50: Role assignment and member removal

**What to build:** An Owner or Admin changes someone's Role, and removes someone who has left — without destroying the spend history that person generated.

**Blocked by:** 44, 49.

**Status:** done

- [x] Role changes take effect immediately and are enforced by policy
- [x] Removing a Member frees their Seat
- [x] A removed Member's Turns remain readable, and Org totals still include them
- [x] A removed Member's keys stop working
- [x] Covered by the policy suite, including that removal is not a cascade delete
