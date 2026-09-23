# 101: An Org can be renamed

**What to build:** Taha, 2026-09-23: "Also allow renaming organisation too." An Org's name is set once, at sign-up, and nothing changed it after.

**Where the ask forks, and what was picked.** Owner or Admin, as every Org-wide setting is (tickets 49, 50, 61); `orgs_write` already says so, so no migration. The control is the pencil every other name uses (tickets 90 and 91), at the top of Org settings. An Org always has a name, so an empty box is refused rather than cleared.

**Blocked by:** 51.

**Status:** done

- [x] Pencil on Org settings, trimmed, 1 to 60 characters
- [x] Owner and Admin may, Manager and Member write nothing and are told so; tested as `sessclone_app`
- [x] The shell shows the new name on the next render
