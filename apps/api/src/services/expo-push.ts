/**
 * Send push notifications via Expo Push API.
 * https://docs.expo.dev/push-notifications/sending-notifications/
 */

import { pool } from '../db/pool';
import { buildSaleNotification, type SaleNotifyOpts } from './sale-notification';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/** Som empacotado no app (ex.: sale_kaching.mp3) + canal Android `sales` — ver App Mobile app.json + setupNotificationChannels */
export type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** iOS: ficheiro de som no bundle; Android: usa o som do canal `channelId` */
  sound?: string | null;
  channelId?: string;
  priority?: 'default' | 'normal' | 'high';
};

type ExpoPushTicket =
  | { status: 'ok'; id: string }
  | { status: 'error'; message: string; details?: { error?: string; fault?: string } };

async function removePushTokenIfInvalid(token: string): Promise<void> {
  try {
    await pool.query('DELETE FROM push_tokens WHERE push_token = $1', [token]);
  } catch {
    /* ignore */
  }
}

async function sendExpoPush(messages: ExpoMessage[]): Promise<void> {
  if (messages.length === 0) return;
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
    });
    const text = await res.text();
    if (!res.ok) {
      console.warn('[ExpoPush] Send failed:', res.status, text.slice(0, 800));
      return;
    }
    let parsed: { data?: ExpoPushTicket[]; errors?: unknown };
    try {
      parsed = JSON.parse(text) as { data?: ExpoPushTicket[]; errors?: unknown };
    } catch {
      console.warn('[ExpoPush] Invalid JSON response:', text.slice(0, 500));
      return;
    }
    if (parsed.errors) {
      console.warn('[ExpoPush] Response errors:', JSON.stringify(parsed.errors).slice(0, 500));
    }
    const tickets = parsed.data;
    if (!Array.isArray(tickets)) return;
    for (let i = 0; i < tickets.length; i++) {
      const ticket = tickets[i];
      const msg = messages[i];
      if (!ticket || ticket.status !== 'error' || !msg) continue;
      const code = ticket.details?.error || ticket.details?.fault;
      const msgText = ticket.message || '';
      console.warn('[ExpoPush] Ticket error:', code || msgText, msgText.slice(0, 200));
      const shouldDrop =
        code === 'DeviceNotRegistered' ||
        /not a registered push/i.test(msgText) ||
        /invalid.*token/i.test(msgText);
      if (shouldDrop && typeof msg.to === 'string') {
        await removePushTokenIfInvalid(msg.to);
      }
    }
  } catch (e) {
    console.warn('[ExpoPush] Error:', e);
  }
}

export async function notifyAccountNewSale(
  pushTokens: { push_token: string }[],
  opts: SaleNotifyOpts
): Promise<void> {
  const { title, body, data } = buildSaleNotification(opts);

  const messages: ExpoMessage[] = pushTokens.map((t) => ({
    to: t.push_token,
    title,
    body,
    data,
    sound: 'sale_kaching.mp3',
    channelId: 'sales',
    priority: 'high',
  }));
  await sendExpoPush(messages);
}
