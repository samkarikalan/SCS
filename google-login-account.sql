-- Google Login support for SCS user accounts.
-- Run once in the Supabase SQL editor before deploying the updated Worker.

begin;

alter table public.user_accounts
  add column if not exists google_user_id text,
  add column if not exists google_display_name text,
  add column if not exists google_picture_url text,
  add column if not exists google_nickname_confirmed boolean not null default true;

-- Social-login-only accounts do not have SCS email passwords.
alter table public.user_accounts alter column email drop not null;
alter table public.user_accounts alter column password_hash drop not null;
alter table public.user_accounts alter column recovery_word drop not null;

create unique index if not exists user_accounts_google_user_id_unique
  on public.user_accounts (google_user_id)
  where google_user_id is not null;

create index if not exists user_accounts_google_email_idx
  on public.user_accounts (lower(email))
  where email is not null;

commit;
