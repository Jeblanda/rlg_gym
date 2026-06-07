-- Run this in Supabase SQL Editor when upgrading an existing RLG database.
alter table public.members
add column if not exists updated_at timestamptz not null default now();

-- Ask PostgREST to reload its schema immediately.
notify pgrst, 'reload schema';
