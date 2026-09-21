# 80: Landing page reads Tier records

**What to build:** The public pricing section renders from the Tier table rather than from copy, and a price change on the admin page is visible without a deploy.

**Blocked by:** 24, 65.

**Status:** done

- [x] Seat price, included seats and retention ceiling read from Tier records
- [x] The read wrapped in `'use cache'` and tagged `cacheTag('tiers')`
- [x] The admin save calls `updateTag('tiers')` so the next request sees the new price
- [x] A webhook or route handler path uses `revalidateTag('tiers', 'max')`, since `updateTag` throws outside a Server Action
- [x] A tier with no price renders as "Contact" rather than as free
- [x] A test that a price change is visible on the next request
