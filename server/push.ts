import webpush from "web-push";
import { db } from "./db";
import { pushSubscriptions } from "../shared/schema";
import { eq, inArray } from "drizzle-orm";

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@maneframe.local";

export const pushConfigured = Boolean(VAPID_PUBLIC && VAPID_PRIVATE);

if (pushConfigured) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
} else {
  console.warn("Web Push disabled: set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY to enable device notifications.");
}

export function vapidPublicKey(): string {
  return VAPID_PUBLIC;
}

export async function saveSubscription(userId: number, sub: { endpoint: string; keys: { p256dh: string; auth: string } }) {
  // Upsert on the unique endpoint so re-subscribing (or a device changing hands) is idempotent.
  await db
    .insert(pushSubscriptions)
    .values({ userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    });
}

export async function removeSubscription(endpoint: string) {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

/** Send a push to every device registered to the given users. Best-effort;
 *  dead subscriptions (410/404) are pruned automatically. Never throws. */
export async function sendPushToUsers(userIds: number[], payload: PushPayload): Promise<void> {
  if (!pushConfigured || userIds.length === 0) return;
  try {
    const uniqueIds = [...new Set(userIds)];
    const subs = await db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, uniqueIds));
    if (subs.length === 0) return;
    const body = JSON.stringify(payload);
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            body,
          );
        } catch (err: any) {
          const code = err?.statusCode;
          if (code === 404 || code === 410) {
            await removeSubscription(s.endpoint).catch(() => {});
          } else {
            console.warn("Push send failed:", code || err?.message);
          }
        }
      }),
    );
  } catch (e) {
    console.warn("sendPushToUsers error:", e);
  }
}
