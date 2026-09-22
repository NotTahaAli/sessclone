# 92: A Session can be archived or hidden

**What to build:** Two ways to take a Session out of the list, asked for by Taha on 2026-09-22.

A busy month is thousands of Sessions, and a reader scrolling for the one that matters is scrolling past a great many that never will — a two-Turn session that opened a file and stopped, a container that died before it did anything. Today the only way to narrow the list is the period, the Project and the person, none of which is "I have dealt with this one".

**Where the ask forks, and what was picked.**

- **Neither state changes a number.** Costs keeps counting every Turn of an archived or a hidden Session, and so does every breakdown. This is what the reader sees, not what the Org spent: a hidden Session that quietly lowered the month's total would make the figure wrong in a way nothing on the page could explain. `turn_costs` is untouched here.
- **Archived is off the default list and reachable by asking for it.** It is the common case — "done with this" — so it is one click to set and one filter to see again.
- **Hidden is never listed, and reachable only by its own link.** It is for a Session a reader never wants to meet again in a list. Still not a delete: the Turns are the billing record, and nothing here removes one.
- **Both are reversible, and both are the Org's rather than the viewer's.** The Session's own Member, or an Owner or Admin — the rule `session_labels_write` already states for naming a Session. Org-wide rather than per-viewer so that two people looking at one list see one list; a per-viewer state would mean an Owner and a Member disagreeing about what is there.
- **The state lives on the row a Session already has.** `session_labels` is keyed on the `(member_id, session_id)` pair, carries the Org, and has the policies this needs. A second table keyed identically would be a second copy of those policies and a second chance for one of them to drift. Its `label` becomes nullable, because a Session can now be archived without being named.

**Blocked by:** 86, 90.

**Status:** todo

- [x] `session_labels.state`, null (listed), `archived` or `hidden`
- [x] Archive and hide from a Session's detail page, by its own Member or by an Owner or Admin, both reversible from the same place
- [x] The Sessions list shows neither by default; a filter shows the archived, and nothing lists the hidden
- [x] A hidden Session's own page still loads for whoever may read it
- [x] Costs, the breakdowns and the per-model figures are unchanged by either state, proven by a test that archives a Session and re-reads the month
- [x] Policies proven in a test run as `sessclone_app`: an unrelated Member cannot archive somebody else's Session, and a refusal writes nothing rather than raising
- [ ] Screenshots at 1440x900 and 390x844, light and dark
