-- Postgres-native background work: queues (pgmq), schedules (pg_cron) and
-- outbound HTTP from SQL (pg_net). Created before the functions that use them,
-- because SQL-language function bodies are validated at creation time.

create extension if not exists pgmq;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
