# 93: Search the Sessions, and show only the ones that failed

**What to build:** Two more filters on the Sessions list, asked for by Taha on 2026-09-22.

Ticket 86 gave the list a period, a Project and a person. Neither of the two questions a reader actually arrives with is answerable: "where is the one I called Thursday's migration", and "which of these went wrong".

**Where the ask forks, and what was picked.**

- **Search matches the name and the session id, and nothing else.** Those are the two things a reader has in hand — the name they gave it, or an id pasted from a terminal. Matching the Project or the person too would make the box a worse version of the two dropdowns beside it.
- **It is a substring match, case-insensitive.** A session id is a uuid nobody types in full, so a prefix-only match would answer nothing.
- **Failed means the Session has a `stop_failure`,** which is what ticket 40 records and ticket 78 reads. A Session with no end marker is not a failure: it was killed, or is still running (ticket 05), and calling that failed would be inventing an ending.
- **A `get` form, as the filters already are.** The period, the Project and the person already ride in the query string, so a link to this list stays a link to a question, and it works with JavaScript off.

**Blocked by:** 78, 86, 90.

**Status:** done

- [x] A search box matching a Session's name or its id, case-insensitive, anywhere in the value
- [x] A "failed only" filter, reading `stop_failure` rather than a missing end marker
- [x] Both ride in the query string with the period, the Project and the person, and none of them resets another
- [x] Both are scoped by the policies, not by the page: a Member searching finds only their own Sessions
- [x] Looked at on production by Taha, who confirmed all three work. No screenshots: the container this was built in had no Supabase session and no Docker for a local stack, so no signed-in page could be driven in it
