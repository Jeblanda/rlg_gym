-- Run once in the Supabase SQL Editor to enable staff operations and admin reports.

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references public.members(id),
  member_name text not null,
  phone text,
  address text,
  attendance_type text not null default 'Member',
  time_in timestamptz not null default now(),
  recorded_by text not null
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references public.members(id),
  member_name text not null,
  amount numeric(12,2) not null check (amount > 0),
  payment_type text not null default 'Renewal',
  paid_at timestamptz not null default now(),
  recorded_by text not null
);

create table if not exists public.renewals (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id),
  member_name text not null,
  old_expiry date not null,
  new_expiry date not null,
  renewal_plan text,
  renewal_months integer,
  amount numeric(12,2) not null check (amount > 0),
  renewed_at timestamptz not null default now(),
  recorded_by text not null
);

alter table public.attendance enable row level security;
alter table public.payments enable row level security;
alter table public.renewals enable row level security;
alter table public.attendance alter column member_id drop not null;
alter table public.attendance add column if not exists phone text;
alter table public.attendance add column if not exists address text;
alter table public.attendance add column if not exists attendance_type text not null default 'Member';
alter table public.payments alter column member_id drop not null;
alter table public.renewals add column if not exists renewal_plan text;
alter table public.renewals add column if not exists renewal_months integer;

alter table public.members drop constraint if exists members_plan_check;
alter table public.members add constraint members_plan_check check (plan in ('Daily', 'Monthly', 'Quarterly', 'Annual'));

drop policy if exists "Authenticated admins can read members" on public.members;
drop policy if exists "Authenticated admins can create members" on public.members;
drop policy if exists "Authenticated admins can update members" on public.members;
drop policy if exists "Authenticated admins can delete members" on public.members;
drop policy if exists "Staff and admins can read members" on public.members;
drop policy if exists "Staff and admins can create members" on public.members;
drop policy if exists "Staff and admins can update members" on public.members;
drop policy if exists "Admins can delete members" on public.members;

create policy "Staff and admins can read members" on public.members for select to authenticated
using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') in ('staff', 'admin'));
create policy "Staff and admins can create members" on public.members for insert to authenticated
with check (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') in ('staff', 'admin'));
create policy "Staff and admins can update members" on public.members for update to authenticated
using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') in ('staff', 'admin'))
with check (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') in ('staff', 'admin'));
create policy "Admins can delete members" on public.members for delete to authenticated
using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin');

drop policy if exists "Staff and admins can record attendance" on public.attendance;
drop policy if exists "Admins can read attendance" on public.attendance;
create policy "Staff and admins can record attendance" on public.attendance for insert to authenticated
with check (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') in ('staff', 'admin'));
create policy "Admins can read attendance" on public.attendance for select to authenticated
using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin');

drop policy if exists "Staff and admins can record payments" on public.payments;
drop policy if exists "Admins can read payments" on public.payments;
create policy "Staff and admins can record payments" on public.payments for insert to authenticated
with check (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') in ('staff', 'admin'));
create policy "Admins can read payments" on public.payments for select to authenticated
using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin');

drop policy if exists "Staff and admins can record renewals" on public.renewals;
drop policy if exists "Admins can read renewals" on public.renewals;
create policy "Staff and admins can record renewals" on public.renewals for insert to authenticated
with check (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') in ('staff', 'admin'));
create policy "Admins can read renewals" on public.renewals for select to authenticated
using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin');

drop policy if exists "Authenticated admins can read member images" on storage.objects;
drop policy if exists "Authenticated admins can upload member images" on storage.objects;
drop policy if exists "Authenticated admins can update member images" on storage.objects;
drop policy if exists "Authenticated admins can delete member images" on storage.objects;
drop policy if exists "Staff and admins can read member images" on storage.objects;
drop policy if exists "Staff and admins can upload member images" on storage.objects;
drop policy if exists "Staff and admins can update member images" on storage.objects;
drop policy if exists "Admins can delete member images" on storage.objects;

create policy "Staff and admins can read member images" on storage.objects for select to authenticated
using (bucket_id = 'member-images' and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') in ('staff', 'admin'));
create policy "Staff and admins can upload member images" on storage.objects for insert to authenticated
with check (bucket_id = 'member-images' and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') in ('staff', 'admin'));
create policy "Staff and admins can update member images" on storage.objects for update to authenticated
using (bucket_id = 'member-images' and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') in ('staff', 'admin'))
with check (bucket_id = 'member-images' and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') in ('staff', 'admin'));
create policy "Admins can delete member images" on storage.objects for delete to authenticated
using (bucket_id = 'member-images' and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin');

grant select, insert, update on public.members to authenticated;
grant select, insert on public.attendance, public.payments, public.renewals to authenticated;

-- Replace the emails and run these statements for each portal user.
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
where lower(email) = lower('YOUR_ADMIN_EMAIL');

update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"staff"}'::jsonb
where lower(email) = lower('YOUR_STAFF_EMAIL');

notify pgrst, 'reload schema';
