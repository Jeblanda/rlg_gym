import nodemailer from "npm:nodemailer@6.9.10";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const requiredEnv = (name: string) => {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing required secret: ${name}`);
  return value;
};

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character]!);

const dateInTimeZone = (timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
};

const addDays = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

const parseReminderDays = () => {
  const values = (Deno.env.get("REMINDER_DAYS") || "7,3,1,0")
    .split(",")
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isInteger(value) && value >= 0);
  return [...new Set(values)].sort((a, b) => b - a);
};

Deno.serve(async (request) => {
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const cronSecret = requiredEnv("CRON_SECRET");
    if (request.headers.get("x-cron-secret") !== cronSecret) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const reminderDays = parseReminderDays();
    if (!reminderDays.length) return jsonResponse({ error: "REMINDER_DAYS has no valid values" }, 500);

    const timeZone = Deno.env.get("GYM_TIME_ZONE") || "Asia/Singapore";
    const gymName = Deno.env.get("GYM_NAME") || "RLG Gym";
    const today = dateInTimeZone(timeZone);
    const lastReminderDate = addDays(today, Math.max(...reminderDays));
    const supabase = createClient(
      requiredEnv("SUPABASE_URL"),
      requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    );

    const { data: members, error: membersError } = await supabase
      .from("members")
      .select("id, name, email, expiry")
      .not("email", "is", null)
      .gte("expiry", today)
      .lte("expiry", lastReminderDate);
    if (membersError) throw membersError;

    const { data: existingReminders, error: remindersError } = await supabase
      .from("membership_expiry_reminders")
      .select("member_id, expiry, days_remaining")
      .gte("expiry", today)
      .lte("expiry", lastReminderDate);
    if (remindersError) throw remindersError;

    const alreadySent = new Set(
      (existingReminders || []).map((item) => `${item.member_id}:${item.expiry}:${item.days_remaining}`),
    );
    const smtpUser = requiredEnv("SMTP_USER");
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: smtpUser,
        pass: requiredEnv("SMTP_PASS"),
      },
    });
    const from = `${gymName} <${smtpUser}>`;

    let sent = 0;
    let skipped = 0;
    const failures: Array<{ memberId: string; error: string }> = [];

    for (const member of members || []) {
      const email = String(member.email || "").trim();
      const daysRemaining = daysBetween(today, member.expiry);
      const reminderKey = `${member.id}:${member.expiry}:${daysRemaining}`;
      if (!email || !reminderDays.includes(daysRemaining) || alreadySent.has(reminderKey)) {
        skipped++;
        continue;
      }

      const dayLabel = daysRemaining === 1 ? "day" : "days";
      const message = daysRemaining === 0
        ? `Your ${gymName} membership expires today.`
        : `Your ${gymName} membership expires in ${daysRemaining} ${dayLabel}.`;

      try {
        await transporter.sendMail({
          from,
          to: email,
          subject: daysRemaining === 0
            ? `${gymName} membership expires today`
            : `${daysRemaining} ${dayLabel} until your ${gymName} membership expires`,
          text: `Hi ${member.name},\n\n${message}\nExpiry date: ${member.expiry}\n\nPlease contact us to renew your membership.\n\n${gymName}`,
          html: `<p>Hi ${escapeHtml(member.name)},</p><p>${escapeHtml(message)}</p><p><strong>Expiry date:</strong> ${escapeHtml(member.expiry)}</p><p>Please contact us to renew your membership.</p><p>${escapeHtml(gymName)}</p>`,
        });

        const { error: logError } = await supabase.from("membership_expiry_reminders").insert({
          member_id: member.id,
          expiry: member.expiry,
          days_remaining: daysRemaining,
          recipient_email: email,
        });
        if (logError) throw logError;
        alreadySent.add(reminderKey);
        sent++;
      } catch (error) {
        failures.push({ memberId: member.id, error: error instanceof Error ? error.message : String(error) });
      }
    }

    return jsonResponse({ date: today, sent, skipped, failed: failures.length, failures });
  } catch (error) {
    console.error(error);
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
