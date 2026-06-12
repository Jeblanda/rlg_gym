create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  member_id text unique not null,
  name text not null,
  dob date not null,
  email text,
  phone text,
  address text,
  emergency_name text,
  emergency_phone text,
  membership_type text not null default 'Standard' check (membership_type in ('Standard', 'VIP')),
  plan text not null check (plan in ('Monthly', 'Quarterly', 'Annual')),
  start_date date not null,
  expiry date not null,
  last_checkin timestamptz,
  notes text,
  face_photo_path text not null,
  valid_id_path text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- CREATE TABLE IF NOT EXISTS does not add columns to an existing table.
alter table public.members add column if not exists updated_at timestamptz not null default now();
alter table public.members add column if not exists membership_type text not null default 'Standard';

alter table public.members enable row level security;

drop policy if exists "Authenticated admins can read members" on public.members;
drop policy if exists "Authenticated admins can create members" on public.members;
drop policy if exists "Authenticated admins can update members" on public.members;
drop policy if exists "Authenticated admins can delete members" on public.members;

create policy "Authenticated admins can read members" on public.members for select to authenticated using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
create policy "Authenticated admins can create members" on public.members for insert to authenticated with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
create policy "Authenticated admins can update members" on public.members for update to authenticated using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin') with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
create policy "Authenticated admins can delete members" on public.members for delete to authenticated using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

insert into storage.buckets (id, name, public)
values ('member-images', 'member-images', false)
on conflict (id) do update set public = false;

drop policy if exists "Authenticated admins can read member images" on storage.objects;
drop policy if exists "Authenticated admins can upload member images" on storage.objects;
drop policy if exists "Authenticated admins can update member images" on storage.objects;
drop policy if exists "Authenticated admins can delete member images" on storage.objects;

create policy "Authenticated admins can read member images" on storage.objects for select to authenticated using (bucket_id = 'member-images' and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
create policy "Authenticated admins can upload member images" on storage.objects for insert to authenticated with check (bucket_id = 'member-images' and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
create policy "Authenticated admins can update member images" on storage.objects for update to authenticated using (bucket_id = 'member-images' and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin') with check (bucket_id = 'member-images' and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
create policy "Authenticated admins can delete member images" on storage.objects for delete to authenticated using (bucket_id = 'member-images' and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- After creating your admin in Authentication > Users, replace the email below
-- and run this final statement once to grant that user portal access.
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
where email = 'YOUR_ADMIN_EMAIL';
