# 118: Signup picks a plan

**What to build:** Taha, 2026-09-23: "by default when someone signs up right now they are locked out till their plan is confirmed by an admin." Picked: the signup chooses Personal or Team up front, the admin confirms.

**Where the ask forks, and what was picked (Taha's picks).**

- Sign-up asks for the plan (and Team size). It writes an `inactive` subscription row on that Tier, so the admin sees what to confirm.

**Status:** done

- [x] Plan choice at sign-up, stored on the subscription row
- [x] Route and policy tests
