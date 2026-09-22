# 91: A person is a name, not only an address

**What to build:** A display name on a person, asked for by Taha on 2026-09-22: "allow members to set names, instead of just being emails".

Every surface that names a person today prints their email — the People list, the Costs breakdown by person, a Session's header, a Turn's facts. An address is an identity and a poor label: it is long, it wraps badly at 390px, and on a personal domain it says nothing at all.

**Where the ask forks, and what was picked.** The name is the person's own, set by them on Your settings, and is one name across the deployment rather than one per Org — `users` is the row that is the person, `members` is their place in an Org, and a name that changed between Orgs would be two answers to "who is this". An Admin does not name other people: the ask is that members set names.

The email is never replaced, only led with. Two people called "Taha" is the ordinary case in a company, and a list that shows only names is a list you cannot act on. So: the name where a label goes, the address beside it, and the address alone when there is no name.

**Blocked by:** 54, 86.

**Status:** done

- [x] `users.display_name`, set and cleared on Your settings by the person themselves
- [x] Every surface that names a person leads with the name when there is one and shows the address beside it
- [x] Nobody can write somebody else's name: `users_write_self` already says so, and a test run as `sessclone_app` proves it rather than assuming it
- [x] A name is trimmed, bounded, and cleared rather than stored blank
- [x] Screenshots at 1440x900 and 390x844, light and dark
