-- Ticket 02's throwaway table, gone now that ticket 33 reports real Turns.
--
-- The migration that created it has been deleted rather than migrated away
-- from, exactly as its own comment said it would be, so a fresh database
-- never has this table. This drop is for the deployments that already ran it:
-- `if exists` so both paths — never created, and created in September — reach
-- the same schema.
drop table if exists probe_rows;
