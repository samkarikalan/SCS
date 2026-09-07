-- Shared player profile fields for email, LINE, and Google accounts.
-- Run once in Supabase SQL Editor before deploying the updated Worker.

alter table public.user_accounts
  add column if not exists gender text;

comment on column public.user_accounts.gender is
  'Player gender selected during account registration or first social login.';

