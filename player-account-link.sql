-- SCS persistent player identity — run once in the Supabase SQL Editor.
-- Match history remains attached to an account after club membership ends.
alter table public.players
  add column if not exists user_account_id uuid;

update public.players p
set user_account_id = m.user_account_id
from public.memberships m
where m.player_id = p.id
  and m.user_account_id is not null
  and p.user_account_id is null;

create index if not exists idx_players_user_account_id
  on public.players(user_account_id)
  where user_account_id is not null;
