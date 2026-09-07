alter table public.slot_claims
  add column if not exists paid_at timestamptz;

create index if not exists idx_slot_claims_paid_at
  on public.slot_claims(paid_at);
