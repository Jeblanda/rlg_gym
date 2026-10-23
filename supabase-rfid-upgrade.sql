-- Run once after supabase-admin-staff-upgrade.sql. Safe to re-run.
-- Card assignments are separate from members so staff cannot read or edit them.
create table if not exists public.member_rfid_cards (
  member_id uuid primary key references public.members(id) on delete cascade,
  rfid_uid text not null unique check (rfid_uid ~ '^[0-9]{10}$'),
  assigned_at timestamptz not null default now()
);

alter table public.member_rfid_cards enable row level security;
drop policy if exists "Admins can read RFID cards" on public.member_rfid_cards;
drop policy if exists "Admins can assign RFID cards" on public.member_rfid_cards;
drop policy if exists "Admins can change RFID cards" on public.member_rfid_cards;
drop policy if exists "Admins can remove RFID cards" on public.member_rfid_cards;
create policy "Admins can read RFID cards" on public.member_rfid_cards for select to authenticated
  using (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');
create policy "Admins can assign RFID cards" on public.member_rfid_cards for insert to authenticated
  with check (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');
create policy "Admins can change RFID cards" on public.member_rfid_cards for update to authenticated
  using (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin')
  with check (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');
create policy "Admins can remove RFID cards" on public.member_rfid_cards for delete to authenticated
  using (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');
revoke all on public.member_rfid_cards from anon, authenticated;
grant select, insert, update, delete on public.member_rfid_cards to authenticated;

alter table public.attendance add column if not exists checkin_method text not null default 'manual';
alter table public.attendance add column if not exists time_out timestamptz;
alter table public.attendance add column if not exists checked_out_by text;
alter table public.attendance add column if not exists rfid_uid text;
alter table public.attendance add column if not exists checkout_rfid_uid text;
alter table public.attendance drop constraint if exists attendance_checkin_method_check;
alter table public.attendance add constraint attendance_checkin_method_check
  check (checkin_method in ('manual', 'rfid'));
create unique index if not exists attendance_one_open_rfid_visit
  on public.attendance (member_id)
  where checkin_method = 'rfid' and time_out is null;

-- Direct browser inserts remain available for the existing manual flows only.
drop policy if exists "Staff and admins can record attendance" on public.attendance;
create policy "Staff and admins can record attendance" on public.attendance for insert to authenticated
  with check (
    coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') in ('staff', 'admin')
    and checkin_method = 'manual'
  );

-- One transaction owns the state change, membership check, and duplicate guard.
create or replace function public.rfid_visit_action(p_uid text, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_member public.members%rowtype;
  v_open public.attendance%rowtype;
  v_recent timestamptz;
  v_now timestamptz := clock_timestamp();
  v_visit_id uuid;
begin
  if auth.uid() is null or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if p_uid is null or p_uid !~ '^[0-9]{10}$' or p_action is null or p_action not in ('checkin', 'checkout') then
    raise exception 'Invalid RFID request';
  end if;

  select m.* into v_member
  from public.member_rfid_cards c
  join public.members m on m.id = c.member_id
  where c.rfid_uid = p_uid;
  if not found then raise exception 'Unknown RFID card'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_member.id::text, 0));
  select * into v_open from public.attendance
  where member_id = v_member.id and checkin_method = 'rfid' and time_out is null
  order by time_in desc limit 1 for update;

  if p_action = 'checkin' then
    if v_open.id is not null then raise exception 'Member is already checked in'; end if;
    if v_member.expiry < timezone('Asia/Manila', v_now)::date then
      raise exception 'Entry denied: membership is expired';
    end if;
    if nullif(v_member.face_photo_path, '') is null then
      raise exception 'A face photo is required for RFID check-in';
    end if;
    select max(coalesce(time_out, time_in)) into v_recent from public.attendance
    where member_id = v_member.id and checkin_method = 'rfid';
    if v_recent > v_now - interval '8 seconds' then
      raise exception 'Card tapped too quickly. Try again in a few seconds';
    end if;
    insert into public.attendance
      (member_id, member_name, phone, address, attendance_type, time_in, recorded_by, checkin_method, rfid_uid)
    values
      (v_member.id, v_member.name, v_member.phone, v_member.address,
       v_member.membership_type || ' Member', v_now, coalesce(auth.jwt() ->> 'email', 'Admin'), 'rfid', p_uid)
    returning id into v_visit_id;
    update public.members set last_checkin = v_now where id = v_member.id;
  else
    if v_open.id is null then raise exception 'Member is not currently checked in'; end if;
    if v_open.time_in > v_now - interval '8 seconds' then
      raise exception 'Card tapped too quickly. Try again in a few seconds';
    end if;
    update public.attendance
    set time_out = v_now, checked_out_by = coalesce(auth.jwt() ->> 'email', 'Admin'), checkout_rfid_uid = p_uid
    where id = v_open.id and time_out is null
    returning id into v_visit_id;
  end if;

  return jsonb_build_object('visit_id', v_visit_id, 'action', p_action, 'time', v_now);
end;
$$;
revoke all on function public.rfid_visit_action(text, text) from public, anon, authenticated;
grant execute on function public.rfid_visit_action(text, text) to authenticated;
notify pgrst, 'reload schema';
