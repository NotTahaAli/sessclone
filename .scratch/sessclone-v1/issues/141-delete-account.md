# 141: Delete your own account

**What to build:** Taha, 2026-09-25: self-serve Delete account. The Privacy page said "To have an account or an Org deleted, email us; there is no self-serve deletion yet."

**What was picked (Taha's decisions, 2026-09-25).**

1. **Delete means anonymize.** Name and email scrubbed, every membership removed, API keys and Devices revoked, transcripts deleted, the sign-in (`auth.users`) deleted. Turns stay as the Org's spend record, shown as "Deleted person · <tag>" with a short stable tag so two deleted people stay apart.
2. **Scheduled from Settings > You.** Type your email to confirm; the sign-in must be under 10 minutes old, else sign in again first.
3. **14-day grace, frozen.** Signed out at once; ingest refuses the person's API keys; the seat stays taken until the final delete. Signing in during the grace shows one page: "Deleting on <date>", Keep my account or Sign out. Keep restores everything.
4. **A daily cron finalizes** after 14 days, deleting the sign-in through Supabase's Admin API with the service role key, server side only (Taha replaced the rule against setting that key).
5. **Last Owner with other Members is blocked** and told to hand over ownership first. An Org where they are the only Member closes at the final delete.
6. **The same email signing up later is a new person.** A self-hosted deployment without the service role key fails the final delete loudly and lists it on the Admin panel.

**Blocked by:** none

**Status:** done

- [x] Schedule, cancel and finalize in SQL; last-Owner rule
- [x] Ingest refuses a scheduled person's keys
- [x] Deletion-pending page on sign-in
- [x] Cron route finalizes, deletes `auth.users`, queues storage
- [x] Deleted person label wherever a name shows
- [x] Privacy and Terms updated
