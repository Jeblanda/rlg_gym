import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return response({ error: "Method not allowed" }, 405);

  const authorization = request.headers.get("Authorization");
  if (!authorization) return response({ error: "Missing authorization token" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: callerData, error: callerError } = await callerClient.auth.getUser();

  if (callerError || callerData.user?.app_metadata?.role !== "admin") {
    return response({ error: "Administrator access required" }, 403);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const body = await request.json().catch(() => ({}));

  if (body.action === "list") {
    const { data, error } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) return response({ error: error.message }, 400);
    const staff = data.users
      .filter((user) => user.app_metadata?.role === "staff")
      .map((user) => ({
        id: user.id,
        fullName: user.user_metadata?.full_name || "",
        email: user.email || "",
        createdAt: user.created_at,
        lastSignInAt: user.last_sign_in_at,
      }));
    return response({ staff });
  }

  if (body.action === "create") {
    const fullName = String(body.fullName || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!fullName || !email || password.length < 8) {
      return response({ error: "Full name, valid email, and an 8-character password are required" }, 400);
    }
    const { data, error } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { role: "staff" },
      user_metadata: { full_name: fullName },
    });
    if (error) return response({ error: error.message }, 400);
    return response({ user: { id: data.user.id, email: data.user.email } }, 201);
  }

  return response({ error: "Unknown action" }, 400);
});
