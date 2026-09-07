-- SCS build 766: temporary 30-minute in-app club invitations
create table if not exists public.club_invite_broadcasts (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  club_name text not null,
  created_by uuid null,
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  stopped_at timestamptz null
);
create index if not exists club_invite_broadcasts_active_idx on public.club_invite_broadcasts (expires_at desc) where stopped_at is null;
