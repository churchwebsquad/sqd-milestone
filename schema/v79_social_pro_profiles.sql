-- v79: Social Pro church profiles
-- Stores manually-created profiles for churches that are not in
-- strategy_account_progress (e.g. Social Pro plan accounts).
-- The Social Hub merges rows from both sources at query time.

create table if not exists public.strategy_social_pro_profiles (
  member        integer primary key,
  church_name   text,
  css_rep       text,
  plan          text        default 'Social Pro',
  website       text,
  notes         text,
  created_by    text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- Keep updated_at current on every write
create or replace function public.set_social_pro_profile_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_social_pro_profile_updated_at on public.strategy_social_pro_profiles;
create trigger trg_social_pro_profile_updated_at
  before update on public.strategy_social_pro_profiles
  for each row execute function public.set_social_pro_profile_updated_at();

-- Staff can read + write; no public access
alter table public.strategy_social_pro_profiles enable row level security;

create policy "Authenticated staff read" on public.strategy_social_pro_profiles
  for select using (auth.role() = 'authenticated');

create policy "Authenticated staff write" on public.strategy_social_pro_profiles
  for all using (auth.role() = 'authenticated');
