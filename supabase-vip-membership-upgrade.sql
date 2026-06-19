-- Run once in the Supabase SQL Editor to add Standard and VIP membership tiers.

alter table public.members
add column if not exists membership_type text not null default 'Standard';

alter table public.payments
add column if not exists membership_type text not null default 'Standard';

alter table public.renewals
add column if not exists membership_type text not null default 'Standard';

alter table public.members drop constraint if exists members_plan_check;
alter table public.members add constraint members_plan_check
check (plan in ('Daily', 'Monthly', 'Quarterly', 'Annual'));

alter table public.members drop constraint if exists members_membership_type_check;
alter table public.members add constraint members_membership_type_check
check (membership_type in ('Standard', 'VIP'));

alter table public.payments drop constraint if exists payments_membership_type_check;
alter table public.payments add constraint payments_membership_type_check
check (membership_type in ('Standard', 'VIP'));

alter table public.renewals drop constraint if exists renewals_membership_type_check;
alter table public.renewals add constraint renewals_membership_type_check
check (membership_type in ('Standard', 'VIP'));

notify pgrst, 'reload schema';
