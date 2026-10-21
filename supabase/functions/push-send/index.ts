import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const MAX_BODY_BYTES = 4_000;
const BATCH_SIZE = 20;
const APP_PATH = "/motovich-opt-site/motovich-app/";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  const maxLength = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let i = 0; i < maxLength; i++) {
    difference |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return difference === 0;
}

async function readBoundedJson(req: Request): Promise<unknown> {
  if (!req.body) return {};
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new RangeError("request_too_large");
    }
    chunks.push(part.value);
  }
  if (!total) return {};
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  if (req.method !== "POST") return json({ error: "method_not_allowed", requestId }, 405);

  const configuredSecret = Deno.env.get("MOTOVICH_PUSH_CRON_SECRET");
  if (!configuredSecret) return json({ error: "server_not_configured", requestId }, 503);
  const suppliedSecret = req.headers.get("x-motovich-cron-secret") ?? "";
  if (!timingSafeEqual(configuredSecret, suppliedSecret)) {
    return json({ error: "unauthorized", requestId }, 401);
  }

  const bodyLength = Number(req.headers.get("content-length") ?? "0");
  if (bodyLength > MAX_BODY_BYTES) return json({ error: "request_too_large", requestId }, 413);

  let body: { title?: unknown; message?: unknown; tag?: unknown } = {};
  try {
    const parsed: unknown = await readBoundedJson(req);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return json({ error: "invalid_request", requestId }, 400);
    }
    body = parsed as { title?: unknown; message?: unknown; tag?: unknown };
  } catch (error) {
    if (error instanceof RangeError) return json({ error: "request_too_large", requestId }, 413);
    return json({ error: "invalid_json", requestId }, 400);
  }

  const title = typeof body.title === "string" ? body.title.trim().slice(0, 80) : "MOTOVICH";
  const message = typeof body.message === "string"
    ? body.message.trim().slice(0, 240)
    : "Пора заглянуть в свой план и сделать следующий шаг.";
  const requestedTag = typeof body.tag === "string" ? body.tag.toLowerCase() : "daily-checkin";
  const tag = /^[a-z0-9-]{1,50}$/.test(requestedTag) ? requestedTag : "daily-checkin";
  if (!message) return json({ error: "message_required", requestId }, 400);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT");
  if (!supabaseUrl || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    return json({ error: "server_not_configured", requestId }, 503);
  }

  try {
    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  } catch (error) {
    console.error("MOTOVICH invalid VAPID configuration", {
      requestId,
      kind: error instanceof Error ? error.name : "unknown",
    });
    return json({ error: "push_not_configured", requestId }, 503);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const subscriptions: Array<{ id: number; endpoint: string; p256dh: string; auth_secret: string }> = [];
  const PAGE_SIZE = 500;
  const MAX_SUBSCRIPTIONS = 10_000;
  for (let offset = 0; offset < MAX_SUBSCRIPTIONS; offset += PAGE_SIZE) {
    const { data, error } = await admin
      .from("motovich_push_subscriptions")
      .select("id,endpoint,p256dh,auth_secret")
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) {
      console.error("MOTOVICH push subscription lookup failed", { requestId, code: error.code });
      return json({ error: "subscription_lookup_failed", requestId }, 503);
    }
    subscriptions.push(...(data ?? []));
    if ((data ?? []).length < PAGE_SIZE) break;
  }

  const payload = JSON.stringify({ title, body: message, tag, url: APP_PATH });
  let sent = 0;
  let failed = 0;
  let removed = 0;

  for (let offset = 0; offset < subscriptions.length; offset += BATCH_SIZE) {
    const batch = subscriptions.slice(offset, offset + BATCH_SIZE);
    const settled = await Promise.allSettled(batch.map(async row => {
      const subscription = {
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh, auth: row.auth_secret },
      };
      try {
        await webpush.sendNotification(subscription, payload, { TTL: 3600, topic: tag });
        return { id: row.id, ok: true, remove: false };
      } catch (error) {
        const statusCode = Number((error as { statusCode?: number })?.statusCode || 0);
        return { id: row.id, ok: false, remove: statusCode === 404 || statusCode === 410 };
      }
    }));

    for (const result of settled) {
      if (result.status !== "fulfilled") {
        failed++;
        continue;
      }
      const item = result.value;
      if (item.ok) sent++;
      else {
        failed++;
        if (item.remove) {
          const { error: deleteError } = await admin
            .from("motovich_push_subscriptions")
            .delete()
            .eq("id", item.id);
          if (!deleteError) removed++;
        }
      }
    }
  }

  // Report counts only; never return or log personal endpoints or subscription keys.
  return json({
    requestId,
    targeted: subscriptions.length,
    truncatedAtSafetyLimit: subscriptions.length >= MAX_SUBSCRIPTIONS,
    sent,
    failed,
    expiredSubscriptionsRemoved: removed,
  });
});
