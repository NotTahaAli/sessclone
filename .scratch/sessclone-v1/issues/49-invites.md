# 49: Invites and joining

**What to build:** An Owner or Admin invites someone by email; they accept and land in the Org. The Tier's seat limit is enforced at that moment.

**Blocked by:** 44, 45, 47.

**Status:** done

- [x] Invitation accepted by a new or existing user. Delivery **by email** is ticket 82: this deployment has no SMTP configured, so the link is shown once to the inviter to pass on.
- [x] Accepting lands the person in the Org with the intended Role
- [x] An acceptance that would exceed the seat limit is refused, and the inviter is told why
- [x] Seats counted from Members only, so a read-only Manager costs nothing
- [x] Invitations expire, and a used invitation cannot be replayed
