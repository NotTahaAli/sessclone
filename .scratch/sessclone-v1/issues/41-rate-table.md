# 41: Rate table and effective dating

**What to build:** Prices live in data, so a price change is a row rather than a deployment, and an old Turn keeps the price that was current when it ran.

**Blocked by:** 10, 23.

**Status:** done

- [x] Seeded from published prices, with the date they were read recorded
- [x] Both cache-write tiers and the cache-read price stored per model, read never computed as a multiple
- [x] Server-tool request pricing seeded, including the one that is free, so the table stays the only place a price lives
- [x] Resolving a rate for a date returns the row in force on that date
- [x] Prices verified against the published source at seed time, never from memory
