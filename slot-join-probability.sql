-- SCS Join Probability — run once in Supabase SQL Editor
alter table public.slots add column if not exists join_probability_requested_at timestamptz;
alter table public.slots add column if not exists join_probability_reminder_at timestamptz;
alter table public.slot_claims add column if not exists join_probability smallint;
alter table public.slot_claims add column if not exists join_probability_updated_at timestamptz;
alter table public.slot_claims drop constraint if exists slot_claims_join_probability_check;
alter table public.slot_claims add constraint slot_claims_join_probability_check check (join_probability is null or join_probability in (25,50,75,100));
create index if not exists idx_slots_join_probability_request on public.slots(join_probability_requested_at) where join_probability_requested_at is not null;
create index if not exists idx_slot_claims_join_probability on public.slot_claims(slot_id, player_id, status);
