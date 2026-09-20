# 80: Landing page reads Tier records

**What to build:** The public pricing section renders from the Tier table rather than from copy, and a price change on the admin page is visible without a deploy.

**Blocked by:** 24, 65.

**Status:** ready-for-agent

- [ ] Seat price, included seats and retention ceiling read from Tier records
- [ ] The read wrapped in `'use cache'` and tagged `cacheTag('tiers')`
- [ ] The admin save calls `updateTag('tiers')` so the next request sees the new price
- [ ] A webhook or route handler path uses `revalidateTag('tiers', 'max')`, since `updateTag` throws outside a Server Action
- [ ] A tier with no price renders as "Contact" rather than as free
- [ ] A test that a price change is visible on the next request
