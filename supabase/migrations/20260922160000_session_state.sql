-- Ticket 92: a Session can be archived or hidden.
--
-- A month is thousands of Sessions and most of them will never matter again.
-- Archived takes one off the default list and leaves it behind a filter;
-- hidden takes it off every list and leaves it reachable by its own link.
--
-- Neither is a delete and neither is a number. `turn_costs` is untouched, so
-- Costs, every breakdown and the per-model figures count an archived Session
-- exactly as they counted it yesterday. A state that quietly lowered the
-- month's total would make the figure wrong in a way nothing on the page
-- could explain.
--
-- On `session_labels` rather than a table of its own. That table is already
-- keyed on the `(member_id, session_id)` pair a Session *is*, already carries
-- the Org for the reason `20260922150000_friendly_names.sql` gives, and
-- already has the two policies this needs: read follows the Session, write is
-- the Session's own Member or an Owner or Admin. A second table keyed
-- identically would be a second copy of those policies and a second chance
-- for one of them to drift from the other.
--
-- The table keeps its name. It now holds more than a label, but it is read by
-- name in four files that shipped an hour ago, and a rename that touched all
-- of them would be a bigger change than the column it is tidying up after.

-- Null is the ordinary state, and the ordinary state is a row that does not
-- exist at all — so this is not `not null default 'listed'`. A Session
-- nobody has named and nobody has archived has no row here, which is what
-- keeps the left join in `sessionList` cheap on the common case.
alter table session_labels add column state text
  constraint session_labels_state_check
    check (state is null or state in ('archived', 'hidden'));

-- A Session can now be archived without being named, so the label stops being
-- the reason the row exists.
alter table session_labels alter column label drop not null;

-- ...which means the row needs a reason to exist of its own. Without this, a
-- clear of both fields would leave a row saying nothing, and the next reader
-- of this table would have to know that `(null, null)` means "absent".
-- `labelSession` and `setSessionState` delete instead, and this is what makes
-- that a rule rather than a habit.
alter table session_labels add constraint session_labels_not_empty
  check (label is not null or state is not null);

-- The Sessions list asks for the states of a page of Sessions on every read,
-- and asks for them by the pair, which the primary key already serves. What
-- it does *not* serve is "the archived ones in this Org", which is the filter
-- ticket 92 adds — a partial index, because the rows with a state are the
-- small minority and the ones without are the case that must stay cheap.
create index session_labels_state_idx on session_labels (org_id, state)
  where state is not null;
