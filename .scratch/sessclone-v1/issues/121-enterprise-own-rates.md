# 121: Enterprise Owners and Admins set their own per-model rates

**What to build:** Taha, 2026-09-23: agreed that an Org on Enterprise sets its own negotiated rates; sessclone bills per seat, so lower rates cannot lower an invoice.

**Where the ask forks, and what was picked (Taha's picks).**

- `org_rate_overrides` write policy widened to Owner or Admin of an Org whose Tier has `features.own_rates`, in the same migration; platform admin keeps write.
- A rates page under Org settings, in rows.

**Blocked by:** 111.

**Status:** todo

- [ ] Migration with its policy, tested as the unprivileged role
- [ ] Org rates page
- [ ] Pricing copy updated
