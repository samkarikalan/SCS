alter table public.slots
  add column if not exists scheduled_post_at timestamptz;

alter table public.slots
  drop constraint if exists slots_status_check;

alter table public.slots
  add constraint slots_status_check
  check (status in ('draft', 'scheduled', 'posted', 'played', 'cancelled'));

create index if not exists idx_slots_scheduled_post_at
  on public.slots(scheduled_post_at);
