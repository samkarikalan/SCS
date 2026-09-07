alter table public.sessions
  add column if not exists source_slot_id uuid references public.slots(id);

alter table public.slots
  add column if not exists played_session_id uuid references public.sessions(id);

create index if not exists idx_sessions_source_slot_id
  on public.sessions(source_slot_id);

create index if not exists idx_slots_played_session_id
  on public.slots(played_session_id);
