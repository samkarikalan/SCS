create table if not exists public.venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  english_name text,
  japanese_name text,
  address text,
  address_ja text,
  latitude double precision,
  longitude double precision,
  maps_url text,
  court_count integer default 0,
  indoor boolean default true,
  parking boolean default false,
  notes text,
  active boolean default true,
  created_by uuid,
  created_at timestamptz default now()
);

alter table public.clubs
  add column if not exists favorite_venues uuid[] default '{}';

alter table public.slots
  add column if not exists venue_id uuid references public.venues(id);

create index if not exists idx_venues_active_name
  on public.venues(active, name);

create index if not exists idx_slots_venue_id
  on public.slots(venue_id);

alter table public.venues enable row level security;

drop policy if exists venues_read_active on public.venues;
create policy venues_read_active
  on public.venues for select
  using (active = true);

drop policy if exists venues_insert_all on public.venues;
create policy venues_insert_all
  on public.venues for insert
  with check (true);

drop policy if exists venues_update_all on public.venues;
create policy venues_update_all
  on public.venues for update
  using (true)
  with check (true);

grant select, insert, update on public.venues to anon, authenticated;
grant select (id, favorite_venues), update (favorite_venues) on public.clubs to anon, authenticated;
grant select (venue_id), update (venue_id) on public.slots to anon, authenticated;

drop policy if exists clubs_favorite_venues_read on public.clubs;
create policy clubs_favorite_venues_read
  on public.clubs for select
  using (true);

drop policy if exists clubs_favorite_venues_update on public.clubs;
create policy clubs_favorite_venues_update
  on public.clubs for update
  using (true)
  with check (true);
