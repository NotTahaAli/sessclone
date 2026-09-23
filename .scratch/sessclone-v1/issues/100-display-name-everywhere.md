# 100: The name a person set reaches every surface

**What to build:** Taha, 2026-09-23: "I setup 'Your name' but some surfaces still show my email." Ticket 91 added `users.display_name` and most surfaces lead with it, but a few still printed the address alone.

The ones found: the account menu in the shell (on every page, so the most visible), a Turn's header, a Manager's heading in the Scopes section of Members, the screen-reader labels on the Role and Scope controls, the operator in the admin frame, and the actor on an Org's subscription history.

**Where the ask forks, and what was picked.** Same rule as ticket 91: the name leads, the address stays where a person needs it to act (the account menu shows it under the name, so you can see which account you are signed in as). Invitations and "signed in as" on the join page keep the address, because there the address is the point.

**Blocked by:** 91.

**Status:** done

- [x] `currentViewer` and `currentOperator` carry the display name, read in the transaction they already open
- [x] Account menu, Turn header, Scopes heading, control labels, admin frame and subscription actor lead with the name
- [x] Tests in `test/org-names.test.ts`, each red with its fix reverted
