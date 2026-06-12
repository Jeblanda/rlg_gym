-- Run this in Supabase SQL Editor when upgrading an existing RLG database.
alter table public.members
add column if not exists updated_at timestamptz not null default now();

alter table public.members
add column if not exists membership_type text not null default 'Standard';

alter table public.payments
add column if not exists membership_type text not null default 'Standard';

alter table public.renewals
add column if not exists membership_type text not null default 'Standard';

alter table public.members drop constraint if exists members_membership_type_check;
alter table public.members add constraint members_membership_type_check
check (membership_type in ('Standard', 'VIP'));

alter table public.payments drop constraint if exists payments_membership_type_check;
alter table public.payments add constraint payments_membership_type_check
check (membership_type in ('Standard', 'VIP'));

alter table public.renewals drop constraint if exists renewals_membership_type_check;
alter table public.renewals add constraint renewals_membership_type_check
check (membership_type in ('Standard', 'VIP'));

-- Ask PostgREST to reload its schema immediately.
notify pgrst, 'reload schema';
