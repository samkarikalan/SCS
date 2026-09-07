alter table slots
add column if not exists court_count integer not null default 1,
add column if not exists session_mode text not null default 'round';

alter table slots
drop constraint if exists slots_session_mode_check;

alter table slots
add constraint slots_session_mode_check
check (session_mode in ('round', 'rolling', 'standard', 'balanced'));
