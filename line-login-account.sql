-- LINE Login support for SCS user accounts.
-- Run once in the Supabase SQL editor before deploying the updated Worker.

begin;

alter table public.user_accounts
  add column if not exists auth_provider text not null default 'email',
  add column if not exists line_user_id text,
  add column if not exists line_display_name text,
  add column if not exists line_picture_url text,
  add column if not exists line_nickname_confirmed boolean not null default true;

-- LINE-only accounts intentionally do not require email credentials.
alter table public.user_accounts alter column email drop not null;
alter table public.user_accounts alter column password_hash drop not null;
alter table public.user_accounts alter column recovery_word drop not null;

update public.user_accounts
set auth_provider = 'email'
where auth_provider is null or btrim(auth_provider) = '';

create unique index if not exists user_accounts_line_user_id_unique
  on public.user_accounts (line_user_id)
  where line_user_id is not null;

create index if not exists user_accounts_auth_provider_idx
  on public.user_accounts (auth_provider);

-- Short-lived, one-time bridge used when iOS returns LINE Login to Safari
-- while the installed PWA remains in its separate storage context.
create table if not exists public.line_login_handoffs (
  id text primary key,
  device_code text,
  verifier_hash text not null,
  status text not null default 'pending'
    check (status in ('pending', 'complete', 'cancelled')),
  account_id text,
  completion_proof text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz not null
);

alter table public.line_login_handoffs
  add column if not exists device_code text;

create unique index if not exists line_login_handoffs_device_code_unique
  on public.line_login_handoffs (device_code)
  where device_code is not null;

create index if not exists line_login_handoffs_expires_idx
  on public.line_login_handoffs (expires_at);

-- The Worker cryptographically validates every handoff. The table is also
-- blocked from the browser-facing /db proxy in worker.js.
grant select, insert, update, delete on public.line_login_handoffs to anon;
grant select, insert, update, delete on public.line_login_handoffs to authenticated;

commit;
