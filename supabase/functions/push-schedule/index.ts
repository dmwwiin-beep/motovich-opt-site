import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const APP_PATH = "/motovich-opt-site/motovich-app/";
const PAGE_SIZE = 500;
const MAX_ROWS = 10_000;
const MAX_DELIVERIES_PER_RUN = 200;
const LATE_WINDOW_MINUTES = 10;
const RETRY_COOLDOWN_MS = 5 * 60 * 1000;
const BATCH_SIZE = 20;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  const maxLength = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let i = 0; i < maxLength; i++) difference |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return difference === 0;
}

function localClock(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: map.year + "-" + map.month + "-" + map.day,
    minuteOfDay: Number(map.hour) * 60 + Number(map.minute),
  };
}

async function taskTag(userId: string, taskId: string, dueOn: string): Promise<string> {
  const input = userId + "|" + taskId + "|" + dueOn;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return "task-" + Array.from(new Uint8Array(digest)).map((v) => v.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

async function claimDelivery(admin: ReturnType<typeof createClient>, userId: string, taskId: string, dueOn: string) {
  const { data: existing, error: lookupError } = await admin
    .from("motovich_push_deliveries")
    .select("id,status,attempts,last_attempt_at")
    .eq("user_id", userId).eq("task_id", taskId).eq("due_on", dueOn).maybeSingle();
  if (lookupError) throw new Error("delivery_ledger_lookup_failed");
  const now = new Date();
  if (existing?.status === "sent") return null;
  if (existing) {
    const lastAttempt = new Date(existing.last_attempt_at).getTime();
    if (now.getTime() - lastAttempt < RETRY_COOLDOWN_MS) return null;
    const { data, error } = await admin.from("motovich_push_deliveries")
      .update({ status: "sending", attempts: Math.min(100, Number(existing.attempts || 0) + 1), last_attempt_at: now.toISOString(), error_code: null })
      .eq("id", existing.id).neq("status", "sent").select("id").maybeSingle();
    if (error || !data) return null;
    return Number(data.id);
  }
  const { data, error } = await admin.from("motovich_push_deliveries").insert({
    user_id: userId, task_id: taskId, due_on: dueOn, status: "sending", attempts: 1, last_attempt_at: now.toISOString(),
  }).select("id").maybeSingle();
  if (error) {
    if (error.code === "23505") return null;
    throw new Error("delivery_ledger_insert_failed");
  }
  return data ? Number(data.id) : null;
}

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  if (req.method !== "POST") return json({ error: "method_not_allowed", requestId }, 405);
  if (Number(req.headers.get("content-length") || "0") > 1000) return json({ error: "request_too_large", requestId }, 413);

  const configuredSecret = Deno.env.get("MOTOVICH_PUSH_CRON_SECRET") || "";
  const suppliedSecret = req.headers.get("x-motovich-cron-secret") || "";
  if (!configuredSecret) return json({ error: "server_not_configured", requestId }, 503);
  if (!timingSafeEqual(configuredSecret, suppliedSecret)) return json({ error: "unauthorized", requestId }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT");
  if (!supabaseUrl || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    return json({ error: "server_not_configured", requestId }, 503);
  }

  try { webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey); }
  catch { return json({ error: "push_not_configured", requestId }, 503); }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const subscriptions: Array<{ user_id: string; id: number; endpoint: string; p256dh: string; auth_secret: string }> = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
    const { data, error } = await admin.from("motovich_push_subscriptions")
      .select("id,user_id,endpoint,p256dh,auth_secret").order("id", { ascending: true }).range(offset, offset + PAGE_SIZE - 1);
    if (error) return json({ error: "subscription_lookup_failed", requestId }, 503);
    subscriptions.push(...(data ?? []));
    if ((data ?? []).length < PAGE_SIZE) break;
  }
  const subscriptionsByUser = new Map<string, typeof subscriptions>();
  for (const subscription of subscriptions) {
    const list = subscriptionsByUser.get(subscription.user_id) || [];
    list.push(subscription);
    subscriptionsByUser.set(subscription.user_id, list);
  }
  if (!subscriptions.length) return json({ requestId, checkedUsers: 0, dueTasks: 0, sent: 0, failed: 0, reason: "no_subscriptions" });

  let checkedUsers = 0, dueTasks = 0, sent = 0, failed = 0, skipped = 0, removed = 0;
  let capped = false;
  const now = new Date();
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
    const { data: states, error } = await admin.from("motovich_user_state")
      .select("user_id,state").order("user_id", { ascending: true }).range(offset, offset + PAGE_SIZE - 1);
    if (error) return json({ error: "state_lookup_failed", requestId }, 503);
    if (!states?.length) break;

    for (const row of states) {
      const userSubscriptions = subscriptionsByUser.get(row.user_id);
      if (!userSubscriptions?.length) continue;
      checkedUsers++;
      const state = row.state && typeof row.state === "object" && !Array.isArray(row.state) ? row.state : {};
      const tasks = Array.isArray(state.tasks) ? state.tasks : [];
      const timeZone = state.preferences && typeof state.preferences.timeZone === "string" ? state.preferences.timeZone : "UTC";
      let clock: { date: string; minuteOfDay: number };
      try { clock = localClock(now, timeZone); }
      catch { clock = localClock(now, "UTC"); }

      for (const task of tasks) {
        if (!task || typeof task !== "object" || task.done === true) continue;
        const taskId = String(task.id || "").slice(0, 120);
        const name = String(task.name || "").replace(/\s+/g, " ").trim().slice(0, 150);
        const date = String(task.date || "");
        const time = String(task.time || "");
        if (!taskId || !name || date !== clock.date || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) continue;
        const dueMinute = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
        const delay = clock.minuteOfDay - dueMinute;
        if (delay < 0 || delay > LATE_WINDOW_MINUTES) continue;
        if (dueTasks >= MAX_DELIVERIES_PER_RUN) { capped = true; break; }

        dueTasks++;
        const dueOn = date + "T" + time;
        let ledgerId: number | null = null;
        try { ledgerId = await claimDelivery(admin, row.user_id, taskId, dueOn); }
        catch { failed++; continue; }
        if (!ledgerId) { skipped++; continue; }

        const payload = JSON.stringify({
          title: "MOTOVICH — напоминание",
          body: "Пора: " + name + " · " + time,
          tag: await taskTag(row.user_id, taskId, dueOn),
          url: APP_PATH,
        });
        let taskSent = 0, taskFailed = 0, taskRemoved = 0;
        for (let i = 0; i < userSubscriptions.length; i += BATCH_SIZE) {
          const batch = userSubscriptions.slice(i, i + BATCH_SIZE);
          const outcomes = await Promise.allSettled(batch.map(async (sub) => {
            try {
              await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_secret } }, payload, { TTL: 3600 });
              return { id: sub.id, ok: true, remove: false };
            } catch (error) {
              const statusCode = Number((error as { statusCode?: number })?.statusCode || 0);
              return { id: sub.id, ok: false, remove: statusCode === 404 || statusCode === 410 };
            }
          }));
          for (const outcome of outcomes) {
            if (outcome.status !== "fulfilled") { taskFailed++; continue; }
            if (outcome.value.ok) taskSent++;
            else {
              taskFailed++;
              if (outcome.value.remove) {
                const { error: deleteError } = await admin.from("motovich_push_subscriptions").delete().eq("id", outcome.value.id);
                if (!deleteError) taskRemoved++;
              }
            }
          }
        }
        sent += taskSent;
        failed += taskFailed;
        removed += taskRemoved;
        await admin.from("motovich_push_deliveries").update({
          status: taskSent > 0 ? "sent" : "failed",
          sent_at: taskSent > 0 ? new Date().toISOString() : null,
          error_code: taskSent > 0 ? null : "all_subscriptions_failed",
        }).eq("id", ledgerId);
      }
      if (capped) break;
    }
    if (capped || states.length < PAGE_SIZE) break;
  }
  return json({ requestId, checkedUsers, dueTasks, sent, failed, skipped, expiredSubscriptionsRemoved: removed, cappedAtSafetyLimit: capped });
});
