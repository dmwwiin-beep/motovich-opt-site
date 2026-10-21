import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

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
  const cors: Record<string, string> = {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };

  if (req.method === "OPTIONS") {
    if (!allowedOrigin || (origin && origin !== allowedOrigin)) return json({ error: "origin_not_allowed" }, 403, cors);
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, cors);
  if (!allowedOrigin || (origin && origin !== allowedOrigin)) return json({ error: "origin_not_allowed" }, 403, cors);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT");
  if (!supabaseUrl || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    return json({ error: "server_not_configured" }, 503, cors);
  }

  const authorization = req.headers.get("authorization") || "";
  const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) return json({ error: "unauthorized" }, 401, cors);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await admin.auth.getUser(tokenMatch[1]);
  if (userError || !userData.user?.id) return json({ error: "unauthorized" }, 401, cors);

  try {
    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  } catch (_) {
    return json({ error: "push_not_configured" }, 503, cors);
  }

  const { data: subscriptions, error: queryError } = await admin
    .from("motovich_push_subscriptions")
    .select("id,endpoint,p256dh,auth_secret")
    .eq("user_id", userData.user.id)
    .limit(20);
  if (queryError) return json({ error: "subscription_lookup_failed" }, 503, cors);
  if (!subscriptions?.length) return json({ sent: 0, failed: 0, message: "subscription_not_found" }, 200, cors);

  const payload = JSON.stringify({
    title: "MOTOVICH — проверка уведомлений",
    body: "Готово! Push-уведомления доходят до этого устройства.",
    tag: "motovich-test",
    url: "/motovich-opt-site/motovich-app/",
  });
  let sent = 0;
  let failed = 0;
  for (const row of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth_secret } },
        payload,
        { TTL: 300, topic: "motovich-test" },
      );
      sent++;
    } catch (error) {
      failed++;
      const statusCode = Number((error as { statusCode?: number })?.statusCode || 0);
      if (statusCode === 404 || statusCode === 410) {
        await admin.from("motovich_push_subscriptions").delete().eq("id", row.id);
      }
    }
  }
  return json({ sent, failed }, 200, cors);
});
