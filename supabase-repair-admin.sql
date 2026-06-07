-- Replace this email, then run the entire script in the Supabase SQL Editor.
-- Sign out of the RLG portal and sign back in after running it.

update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
where lower(email) = lower('YOUR_ADMIN_EMAIL');

alter table public.members add column if not exists updated_at timestamptz not null default now();
alter table public.members enable row level security;

drop policy if exists "Authenticated admins can read members" on public.members;
drop policy if exists "Authenticated admins can create members" on public.members;
drop policy if exists "Authenticated admins can update members" on public.members;
drop policy if exists "Authenticated admins can delete members" on public.members;

create policy "Authenticated admins can read members"
on public.members for select to authenticated
using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin');

create policy "Authenticated admins can create members"
on public.members for insert to authenticated
with check (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin');

create policy "Authenticated admins can update members"
on public.members for update to authenticated
using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin')
with check (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin');

create policy "Authenticated admins can delete members"
on public.members for delete to authenticated
using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin');

insert into storage.buckets (id, name, public)
values ('member-images', 'member-images', false)
on conflict (id) do update set public = false;

drop policy if exists "Authenticated admins can read member images" on storage.objects;
drop policy if exists "Authenticated admins can upload member images" on storage.objects;
drop policy if exists "Authenticated admins can update member images" on storage.objects;
drop policy if exists "Authenticated admins can delete member images" on storage.objects;

create policy "Authenticated admins can read member images"
on storage.objects for select to authenticated
using (bucket_id = 'member-images' and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin');

create policy "Authenticated admins can upload member images"
on storage.objects for insert to authenticated
with check (bucket_id = 'member-images' and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin');

create policy "Authenticated admins can update member images"
on storage.objects for update to authenticated
using (bucket_id = 'member-images' and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin')
with check (bucket_id = 'member-images' and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin');

create policy "Authenticated admins can delete member images"
on storage.objects for delete to authenticated
using (bucket_id = 'member-images' and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin');

-- This should return your email and "admin".
select email, raw_app_meta_data ->> 'role' as role
from auth.users
where lower(email) = lower('YOUR_ADMIN_EMAIL');
