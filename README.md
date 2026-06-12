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

## Automatic membership expiry emails

The `membership-expiry-reminders` Edge Function sends each member an email when
their membership has 7, 3, 1, or 0 days remaining. It records successful sends
so running the job more than once does not send the same reminder twice.

1. Run `supabase-membership-reminders.sql` in the Supabase SQL Editor.
2. Copy `.env.local.example` to `.env.local`, then replace its three placeholder
   values. Use your Gmail address, a 16-character Google App Password without
   spaces, and a long random `CRON_SECRET`. Do not use your normal Gmail
   password. The `.env.local` file is ignored by Git and must never be committed.
3. Upload the values from `.env.local` to Supabase Secrets:

```powershell
npx supabase@latest secrets set --env-file .env.local --project-ref rhpnpcdirkyuzznzkvud
```

The deployed Edge Function reads its values from Supabase Secrets, not directly
from your local file.

4. Deploy the function without gateway JWT verification. The function still
   requires the private `x-cron-secret` header:

```powershell
npx supabase@latest functions deploy membership-expiry-reminders --no-verify-jwt --project-ref rhpnpcdirkyuzznzkvud
```

5. In Supabase, open **Integrations > Cron**, create a daily HTTP request job,
   and POST to:

```text
https://rhpnpcdirkyuzznzkvud.supabase.co/functions/v1/membership-expiry-reminders
```

Add the request header `x-cron-secret` with the same value used for
`CRON_SECRET` from your private `.env.local`. Schedule it once each morning.
Change `REMINDER_DAYS` to adjust which days trigger an email.

To test the deployed function manually, run:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "https://rhpnpcdirkyuzznzkvud.supabase.co/functions/v1/membership-expiry-reminders" `
  -Headers @{ "x-cron-secret" = ((Get-Content .env.local | ConvertFrom-StringData).CRON_SECRET) }
```

Only members with an email address and an expiry matching a configured reminder
day receive a message. The response reports how many reminders were sent,
skipped, or failed.

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
