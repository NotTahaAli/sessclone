# 51: Org settings — timezone

**What to build:** The Org picks the timezone its days are measured in, so one chart means the same thing to everyone reading it.

**Blocked by:** 44, 45.

**Status:** ready-for-agent

- [ ] Timezone set by an Owner or Admin, defaulted sensibly on Org creation
- [ ] Stored on the Org, available to every query that buckets by day
- [ ] Changing it re-buckets existing charts rather than rewriting stored data
