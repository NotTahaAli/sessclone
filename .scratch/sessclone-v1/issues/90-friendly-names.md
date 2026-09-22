# 90: A Project and a Session can be given a name

**What to build:** A friendly name for a Project and for a Session, asked for by Taha on 2026-09-22.

A Device has had one since ticket 57 (`devices.nickname`, falling back to the key). Nothing else does. A Project reads as `local:vm:/home/user` or a git remote, and a Session reads as a uuid — and a cloud Session routinely splits across two Project keys (finding 74), so the key is exactly what a reader cannot use to tell one from another.

**Where the ask forks, and what was picked.**

- **A Project's name is the Org's, one per Project, and an Owner's or an Admin's to set.** A Project is already Org-scoped so that one repository cloned by four people is one Project (ticket 22); a per-Member name would undo that at the display layer, so that the same row would be called two things in two people's Costs. The write is Owner or Admin, as every Org-wide setting is (tickets 49, 50, 61).
- **A Session's name is one per Session, written by the person whose Session it is or by an Owner or Admin, and read by whoever may read the Session.** A Session belongs to one Member, so its own Member naming it is the common case; an Owner reviewing the month should not be locked out of labelling what they are looking at.

Neither name is identity. The key stays the identity, stays visible beside the name, and stays what the breakdowns group on — renaming a Project must not move a dollar.

`projects` has no update policy at all today and `sessclone_app` holds no write grant on it, which the app-role migration calls a second lock. Both change here, for the one column, with a trigger pinning the rest — the shape `devices` already has.

A Session is not a table: it is the `(member_id, session_id)` pair every Turn carries. So the label is a small table of its own keyed on that pair, with the Org on the row so a label cannot be filed against an Org the Member does not belong to.

**Blocked by:** 22, 86, 88.

**Status:** done

- [x] `projects.nickname`, set from the Costs drill-down for a Project, by an Owner or an Admin and by nobody else
- [x] `session_labels`, set from a Session's detail by its own Member or by an Owner or Admin
- [x] Every surface that names a Project or a Session shows the name when there is one and the key when there is not, with the key still shown beside the name
- [x] Clearing the box removes the name rather than storing an empty one
- [x] A rename writes only the name: a trigger pins `key`, `remote`, the Org and the timestamps on `projects`, as `devices` pins its own
- [x] Policies proven in a test run as `sessclone_app`, both directions: a Member cannot rename a Project, an unrelated Member cannot label somebody else's Session, and a refusal writes nothing rather than raising
- [x] Screenshots at 1440x900 and 390x844, light and dark
