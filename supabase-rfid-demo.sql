-- OPTIONAL: run only in a test Supabase project after supabase-rfid-upgrade.sql.
-- First upload these six images to the private member-images bucket:
-- rfid-demo/expired-face.jpg, rfid-demo/expired-id.jpg
-- rfid-demo/active-face.jpg, rfid-demo/active-id.jpg
-- rfid-demo/expiring-face.jpg, rfid-demo/expiring-id.jpg
-- The script stops if any image is missing. It never updates existing members.
do $$
declare
  demo record;
  demo_member uuid;
  demo_expiry date;
  demo_today date := timezone('Asia/Manila', now())::date;
begin
  for demo in
    select * from (values
      ('RLG-RFID-DEMO-01', '4051388725', 'Ava Santos', 'expired', -3, '1992-04-12', '09170000001'),
      ('RLG-RFID-DEMO-02', '3107939326', 'Marco Reyes', 'active', 45, '1995-07-21', '09170000002'),
      ('RLG-RFID-DEMO-03', '3731461465', 'Lia Cruz', 'expiring', 7, '1998-11-03', '09170000003')
    ) as d(member_id, uid, name, photo_name, expiry_offset, birth_date, phone)
  loop
    if not exists (select 1 from storage.objects where bucket_id = 'member-images' and name = 'rfid-demo/' || demo.photo_name || '-face.jpg')
       or not exists (select 1 from storage.objects where bucket_id = 'member-images' and name = 'rfid-demo/' || demo.photo_name || '-id.jpg') then
      raise exception 'Upload both private demo images for % before running this script', demo.member_id;
    end if;

    demo_expiry := demo_today + demo.expiry_offset;
    insert into public.members
      (member_id, name, dob, email, phone, address, emergency_name, emergency_phone,
       membership_type, plan, start_date, expiry, notes, face_photo_path, valid_id_path)
    values
      (demo.member_id, demo.name, demo.birth_date::date,
       lower(replace(demo.name, ' ', '.')) || '@example.test', demo.phone,
       'RFID demo profile, Manila', 'Demo Contact', '09179999999',
       'Standard', 'Annual', (demo_expiry - interval '1 year')::date, demo_expiry,
       'Test profile only. Do not use for real admission.',
       'rfid-demo/' || demo.photo_name || '-face.jpg',
       'rfid-demo/' || demo.photo_name || '-id.jpg')
    on conflict (member_id) do nothing;

    select id into demo_member from public.members
    where member_id = demo.member_id and name = demo.name
      and notes = 'Test profile only. Do not use for real admission.';
    if demo_member is null then
      raise exception 'Demo member ID % belongs to a different member; no records changed', demo.member_id;
    end if;
    insert into public.member_rfid_cards (member_id, rfid_uid)
    values (demo_member, demo.uid)
    on conflict (member_id) do nothing;
    if not exists (select 1 from public.member_rfid_cards where member_id = demo_member and rfid_uid = demo.uid) then
      raise exception 'Demo member % has a different RFID card; no records changed', demo.member_id;
    end if;
  end loop;
end;
$$;
