-- The Node price proxy uses the service_role key to upsert catalog rows.
-- Baseline only granted anon/authenticated; PostgREST then returns 42501.

grant usage on schema public to service_role;

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select, update on all sequences in schema public to service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;

alter default privileges in schema public
  grant usage, select, update on sequences to service_role;
