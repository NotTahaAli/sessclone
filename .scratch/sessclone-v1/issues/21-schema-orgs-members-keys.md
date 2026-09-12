# 21: Schema — orgs, users, members, API keys, scopes

**What to build:** The account tables and their policies, so an Org, its Members, their Roles, a Manager's Scope, and their API keys all have somewhere to live.

**Blocked by:** 01, 11.

**Status:** ready-for-agent

- [ ] Tables for orgs, users, members, api_keys, and member_scopes
- [ ] Role recorded per member; platform administration flagged on the user, outside any Org
- [ ] API keys store a hash and a short display prefix, never the key
- [ ] Policies ship in the same migration as the tables
- [ ] Migration applies and rolls forward cleanly from empty
