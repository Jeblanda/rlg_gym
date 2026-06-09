# RLG Gym Staff and Admin Portals

Two role-based dashboards:

- `index.html` is the staff portal for member management, verification, check-ins, renewals, and PHP 80 daily walk-ins.
- `admin.html` includes all staff features plus attendance history, reports, revenue summaries, and CSV exports.
- Admins can securely create staff login accounts from the Staff Accounts section.

## Supabase setup

1. Open the Supabase SQL Editor and run `supabase-setup.sql`.
2. Before running its final statement, replace `YOUR_ADMIN_EMAIL` with the
   email address of a user created under Authentication > Users.
3. Confirm the `member-images` storage bucket is private.
4. Run `supabase-admin-staff-upgrade.sql`, replace both placeholder emails, and sign back in.
5. Deploy the admin-only staff account function:

```powershell
npx supabase@latest login
npx supabase@latest functions deploy manage-staff --project-ref rhpnpcdirkyuzznzkvud
```

The Edge Function uses Supabase's server-side service-role environment variable.
Never place the service-role key in `supabase-config.js` or other browser files.

The browser uses the publishable anon key in `supabase-config.js`. Never place
the Supabase service-role key in this project.

## Run locally

```powershell
python -m http.server 8080 --bind 0.0.0.0
```

Member records are stored in Supabase and member images are uploaded to the
private `member-images` bucket. Access is restricted using the `"admin"` and
`"staff"` roles in Supabase user app metadata.

## Deploy to Vercel

1. Push this directory to a private GitHub repository.
2. Import the repository at https://vercel.com/new.
3. Select framework preset **Other** and deploy without a build command.
4. In Supabase, open Authentication > URL Configuration.
5. Set the Site URL to the final Vercel URL and add it under Redirect URLs.

The Supabase anon key is intended for browser use. Security is enforced by the
row-level security policies in `supabase-setup.sql`.

If adding a member reports a row-level security error, run
`supabase-repair-admin.sql` after replacing `YOUR_ADMIN_EMAIL`, then sign out
and back into the portal so Supabase issues a fresh admin session token.

When upgrading a database created by an older portal version, run
`supabase-migrate-existing.sql` once in the Supabase SQL Editor.
