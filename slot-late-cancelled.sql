alter table slot_claims
drop constraint if exists slot_claims_status_check;

alter table slot_claims
add constraint slot_claims_status_check
check (status in ('confirmed', 'waitlist', 'cancelled', 'late_cancelled'));
