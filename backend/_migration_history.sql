select version, name, statements is null as statements_null, cardinality(statements) as statement_count
from supabase_migrations.schema_migrations
order by version desc
limit 8;
