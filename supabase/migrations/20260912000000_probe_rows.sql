-- Ticket 02's throwaway table: enough to prove a Stop hook can reach the
-- database and no more. Ticket 22 replaces it with the real `turns` table,
-- its identity index, and its RLS policies — so this migration is expected to
-- be deleted, not migrated away from.
create table probe_rows (
  id bigint generated always as identity primary key,
  session_id text not null,
  received_at timestamptz not null default now()
);
