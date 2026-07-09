-- v80: Social Hub pre-fetch cache
-- Stores ClickUp srp-tasks + Notion SMM assignments so the Social Hub
-- reads from Supabase (fast) rather than hitting external APIs on every
-- page load. Refreshed by the srp-hub-cache-refresh edge function via
-- pg_cron 5× per day.

create table if not exists public.strategy_srp_hub_cache (
  cache_key    text primary key,          -- 'srp_tasks' | 'smm_assignments'
  data         jsonb        not null,
  refreshed_at timestamptz  default now()
);

-- Authenticated read (hub page), service-role write (edge function)
alter table public.strategy_srp_hub_cache enable row level security;

create policy "Authenticated read cache" on public.strategy_srp_hub_cache
  for select using (auth.role() = 'authenticated');

-- Seed empty rows so the hub never gets a 404 on first load
insert into public.strategy_srp_hub_cache (cache_key, data)
values ('srp_tasks',       '{"tasks":[],"allTasks":[]}'::jsonb),
       ('smm_assignments', '{"assignments":[]}'::jsonb)
on conflict (cache_key) do nothing;

-- ── pg_cron schedule ──────────────────────────────────────────────────────────
-- Requires pg_cron and pg_net extensions (both enabled on Supabase by default).
-- Times are UTC. Eastern equivalents:
--   03:00 UTC = 11pm ET  |  11:00 UTC = 7am ET  |  17:00 UTC = 1pm ET
--   20:00 UTC = 4pm ET   |  23:00 UTC = 7pm ET
--
-- Replace <PROJECT_REF> and <SERVICE_ROLE_KEY> with your actual values.

select cron.schedule(
  'srp-hub-cache-refresh-1',
  '0 3 * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/srp-hub-cache-refresh',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

select cron.schedule(
  'srp-hub-cache-refresh-2',
  '0 11 * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/srp-hub-cache-refresh',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

select cron.schedule(
  'srp-hub-cache-refresh-3',
  '0 17 * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/srp-hub-cache-refresh',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

select cron.schedule(
  'srp-hub-cache-refresh-4',
  '0 20 * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/srp-hub-cache-refresh',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

select cron.schedule(
  'srp-hub-cache-refresh-5',
  '0 23 * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/srp-hub-cache-refresh',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);
