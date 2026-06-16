# RLG Gym Staff and Admin Portals

Two role-based dashboards:

- `index.html` is the staff portal for member management, verification, check-ins, renewals, and PHP 80 daily walk-ins.
- `admin.html` includes all staff features plus attendance history, reports, revenue summaries, and CSV exports.
- Admins can securely create staff login accounts from the Staff Accounts section.

## User manual

This manual explains how to use and maintain the RLG Gym Staff Portal and Admin Dashboard.

### Portal overview

The system has two web portals:

- `index.html` - Staff Portal for member lookup, verification, check-ins, member creation, renewals, and daily walk-ins.
- `admin.html` - Admin Dashboard with all staff features plus attendance history, reports, CSV exports, and staff account management.

All member, attendance, payment, renewal, and staff-login data is stored in Supabase. Member photos and valid ID images are stored in the private `member-images` Supabase storage bucket.

### User roles

#### Staff

Staff users can:

- Sign in to the Staff Portal.
- Add and update member profiles.
- Upload member face photos and valid ID images.
- Verify membership status.
- Confirm member check-ins.
- Record PHP 80 daily walk-ins.
- Renew memberships and record renewal payments.

#### Admin

Admin users can do everything staff users can do. Admin users can also:

- View attendance records.
- Filter attendance by date.
- Export attendance CSV files.
- View business reports.
- Export report summaries.
- View Standard and VIP revenue totals.
- Create staff login accounts.

### Signing in

1. Open the correct portal:
   - Staff: `index.html`
   - Admin: `admin.html`
2. Enter the email address and password assigned to the account.
3. Click **Sign in to portal**.

If sign-in succeeds, the dashboard opens. If the account has no assigned `staff` or `admin` role, the portal blocks access.

### Main dashboard

After signing in, the dashboard shows:

- **Verification panel** - Search for a member who has arrived at the gym.
- **Metrics** - Total members, active memberships, expiring memberships, and expired memberships.
- **Membership directory** - Searchable and filterable list of member records.

Membership status is calculated from the expiry date:

- **Active** - Membership expires more than 14 days from today.
- **Expiring soon** - Membership expires within 14 days.
- **Expired** - Membership expiry date has passed.

### Add a member

1. Click **Add member**.
2. Upload a clear face photo.
3. Upload a clear valid ID image.
4. Enter the required member details:
   - Full legal name
   - Member ID
   - Date of birth
   - Email
   - 11-digit phone number
   - Membership type
   - Membership plan
   - Start date
   - Home address
   - Emergency contact name
   - Emergency contact phone
5. Review the automatic expiry date.
6. Add notes if needed.
7. Click **Save member profile**.

Notes:

- Member IDs must be unique.
- Phone and emergency phone fields require 11 digits.
- Uploaded images must be smaller than 10 MB each.
- The app resizes uploaded photos before storing them.

### Membership types and plans

The portal supports these membership types:

- Standard Gym
- VIP Gym

The portal supports these plans:

- Daily
- Monthly
- Quarterly
- Annual

Default rates used by the portal:

- Daily walk-in: PHP 80
- Standard monthly renewal: PHP 800 per month

VIP renewal payment amounts are entered manually during renewal.

### Verify a member

1. Go to the verification panel.
2. Search by member ID, name, email, phone number, or membership type.
3. Review the result:
   - Member photo
   - Member ID
   - Membership type
   - Expiry date
   - Current status
4. If the membership is active or expiring soon, click the check-in button.
5. If the membership is expired, do not admit the member until the membership is renewed.

When a check-in is confirmed, the portal:

- Adds an attendance record.
- Updates the member's last check-in time.

### View or edit a member profile

1. In the Membership Directory, find the member.
2. Click **View full profile**.
3. Review the profile details, photos, valid ID image, notes, and membership status.
4. Use the available actions:
   - **Confirm check-in**
   - **Edit profile**
   - **Renew plan**

When editing a profile, update the fields and click **Save member profile**.

### Renew a membership

1. Open the member's full profile.
2. Click **Renew plan**.
3. Select the membership type.
4. Select the renewal plan.
5. Confirm or adjust the number of months.
6. Enter the payment amount in PHP.
7. Review the old expiry date and new expiry date.
8. Click **Confirm renewal**.

When a renewal is confirmed, the portal:

- Adds a renewal record.
- Adds a payment record.
- Updates the member's membership type, plan, and expiry date.

If the member has not expired yet, the renewal starts from the current expiry date. If the member is already expired, the renewal starts from today.

### Record a daily walk-in

1. Click **Record walk-in**.
2. Enter the walk-in customer's:
   - Full name
   - 11-digit phone number
   - Home address
3. Click **Record walk-in and payment**.

The portal records:

- One attendance entry with type `Walk-in`.
- One payment entry for PHP 80.

### Admin: attendance

Admins can view attendance in the Admin Dashboard.

1. Open `admin.html`.
2. Sign in with an admin account.
3. Click **Attendance** in the sidebar.
4. Use the date field to filter records by visit date.
5. Click **Export CSV** to download `attendance-report.csv`.

The attendance table shows:

- Attendance ID
- Name
- Type
- Phone
- Address
- Date of visit
- Time in
- Recorded by

### Admin: reports

Admins can view business reports from the Reports section.

1. Click **Reports** in the sidebar.
2. Select a report month.
3. Review the summary cards.
4. Click **Export summary** to download `business-summary.csv`.

Reports include:

- Total active members
- Total expired members
- Daily attendance
- Monthly attendance
- Payment count
- Payment amount
- Standard revenue
- VIP revenue
- Renewal count
- Revenue today
- Revenue this month

### Admin: staff accounts

Admins can create staff login accounts.

1. Open the Admin Dashboard.
2. Click **Staff Accounts**.
3. Click **Create staff account**.
4. Enter:
   - Full name
   - Email address
   - Password
   - Confirm password
5. Click **Create staff account**.

The new staff account can sign in to the Staff Portal immediately after creation.

Passwords must be at least 8 characters.

### Automatic membership expiry emails

The `membership-expiry-reminders` Supabase Edge Function can send expiry reminder emails.

By default, reminders are sent when a member's expiry is:

- 7 days away
- 3 days away
- 1 day away
- Today

Only members with an email address receive reminders. Each reminder is logged so the same reminder is not sent twice.

The reminder job requires:

- `SMTP_USER`
- `SMTP_PASS`
- `CRON_SECRET`
- Supabase project secrets
- A daily Supabase Cron HTTP request with the `x-cron-secret` header

See the detailed setup commands in the **Automatic membership expiry emails** section below.

### Troubleshooting

#### Sign-in works, but access is denied

The account may not have a `staff` or `admin` role in Supabase app metadata. Assign the correct role, then sign out and sign in again.

#### Adding or editing a member fails with a security or row-level policy error

Run the role and policy setup scripts again, then sign out and sign in again so Supabase issues a fresh session token.

#### Staff account creation fails

Check that:

- You are signed in as an admin.
- The `manage-staff` Edge Function is deployed.
- The function has access to the Supabase service-role secret.
- The password is at least 8 characters.

#### Member images do not load

Check that:

- The `member-images` bucket exists.
- The bucket is private.
- Storage policies allow staff and admins to read and upload images.
- The signed image URLs have not expired. Refreshing the page requests fresh signed URLs.

#### Reminder emails are not sending

Check that:

- `membership-expiry-reminders` is deployed with `--no-verify-jwt`.
- Supabase Secrets include the SMTP and cron values.
- The Cron job sends a POST request.
- The request includes the correct `x-cron-secret` header.
- Members have valid email addresses.
- Member expiry dates match one of the configured reminder days.

#### Attendance or reports are empty

Attendance and payment records are created only after check-ins, walk-ins, or renewals are recorded. Admin reports also depend on the selected date or month filter.

### Security notes

- Use separate accounts for each staff member.
- Admin accounts should be limited to trusted users.
- Do not share passwords.
- Do not commit `.env.local`.
- Do not expose the Supabase service-role key in browser code.
- Keep the `member-images` bucket private.
- Use Supabase row-level security policies to enforce access.

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

To enable separate Standard Gym and VIP Gym memberships and payment reporting,
run `supabase-vip-membership-upgrade.sql` once in the Supabase SQL Editor.
