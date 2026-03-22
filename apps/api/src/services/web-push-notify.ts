import webpush from 'web-push';
import { pool } from '../db/pool';
import { buildSaleNotification, type SaleNotifyOpts } from './sale-notification';

let vapidReady = false;

function ensureVapid(): boolean {
  const pub = process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
  const priv = process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim();
  const contact = (process.env.WEB_PUSH_CONTACT || 'mailto:support@trajettu.com').trim();
  if (!pub || !priv) return false;
  if (!vapidReady) {
    webpush.setVapidDetails(contact, pub, priv);
    vapidReady = true;
  }
  return true;
}

export function isWebPushConfigured(): boolean {
  return !!(process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim() && process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim());
}

export async function notifyAccountWebPushSale(accountId: number, opts: SaleNotifyOpts): Promise<void> {
  if (!ensureVapid()) return;

  const { title, body, data } = buildSaleNotification(opts);
  const payload = JSON.stringify({ title, body, data });

  let rows: { endpoint: string; p256dh: string; auth_key: string }[];
  try {
    const res = await pool.query(
      `SELECT endpoint, p256dh, auth_key FROM web_push_subscriptions WHERE account_id = $1`,
      [accountId]
    );
    rows = res.rows;
  } catch (e) {
    console.warn('[WebPush] load subscriptions failed:', e);
    return;
  }

  for (const row of rows) {
    const subscription = {
      endpoint: row.endpoint,
      keys: { p256dh: row.p256dh, auth: row.auth_key },
    };
    try {
      await webpush.sendNotification(subscription, payload, { TTL: 3600 });
    } catch (err: unknown) {
      const status = (err as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) {
        await pool.query('DELETE FROM web_push_subscriptions WHERE endpoint = $1', [row.endpoint]).catch(() => {});
      } else {
        console.warn('[WebPush] send failed:', err);
      }
    }
  }
}
