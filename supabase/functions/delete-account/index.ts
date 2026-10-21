import { createClient } from "npm:@supabase/supabase-js@2";

function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

Deno.serve(async (req: Request) => {
  const allowedOrigin = (Deno.env.get("MOTOVICH_ALLOWED_ORIGIN") || "").replace(/\/+$/, "");
  const origin = req.headers.get("origin") || "";
  const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };

  if (req.method === "OPTIONS") {
    if (allowedOrigin && origin && origin !== allowedOrigin) return json({ error: "origin_not_allowed" }, 403, corsHeaders);
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, corsHeaders);
  if (!allowedOrigin || (origin && origin !== allowedOrigin)) return json({ error: "origin_not_allowed" }, 403, corsHeaders);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "server_not_configured" }, 503, corsHeaders);

  const authorization = req.headers.get("authorization") || "";
  const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) return json({ error: "unauthorized" }, 401, corsHeaders);

  const contentLength = Number(req.headers.get("content-length") || "0");
  if (contentLength > 2_000) return json({ error: "request_too_large" }, 413, corsHeaders);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400, corsHeaders);
  }
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      (body as { confirmation?: unknown }).confirmation !== "DELETE_MY_ACCOUNT") {
    return json({ error: "confirmation_required" }, 400, corsHeaders);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await admin.auth.getUser(tokenMatch[1]);
  if (userError || !userData.user?.id) return json({ error: "unauthorized" }, 401, corsHeaders);

  // Delete only the Auth user identified by the validated bearer token.
  // Foreign-key cascades remove that user's cloud state and Push subscriptions.
  const { error: deleteError } = await admin.auth.admin.deleteUser(userData.user.id);
  if (deleteError) {
    console.error("MOTOVICH account deletion failed", { status: deleteError.status || "unknown" });
    return json({ error: "account_deletion_failed" }, 500, corsHeaders);
  }
  return json({ deleted: true }, 200, corsHeaders);
});
