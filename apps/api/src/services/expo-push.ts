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
  collapseId?: string;
  tag?: string;
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
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (process.env.EXPO_ACCESS_TOKEN) {
      headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
    }

    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers,
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
    let ok = 0;
    let err = 0;
    for (let i = 0; i < tickets.length; i++) {
      const ticket = tickets[i];
      const msg = messages[i];
      if (!ticket || !msg) continue;
      if (ticket.status === 'ok') {
        ok += 1;
        continue;
      }
      err += 1;
      const code = ticket.status === 'error' ? ticket.details?.error || ticket.details?.fault : undefined;
      const msgText = ticket.status === 'error' ? ticket.message || '' : '';
      console.warn('[ExpoPush] Ticket error:', code || msgText, msgText.slice(0, 200));
      if (ticket.status !== 'error') continue;
      const shouldDrop =
        code === 'DeviceNotRegistered' ||
        /not a registered push/i.test(msgText) ||
        /invalid.*token/i.test(msgText);
      if (shouldDrop && typeof msg.to === 'string') {
        await removePushTokenIfInvalid(msg.to);
      }
    }
    if (ok > 0) {
      console.log(`[ExpoPush] ${ok} ticket(s) ok${err ? `, ${err} error(s)` : ''}`);
    }
  } catch (e) {
    console.warn('[ExpoPush] Error:', e);
  }
}

export type ExpoPushTokenRow = { push_token: string; platform?: string | null };

/**
 * Android: não enviar `sound` no payload — o som vem do canal `sales` (evita rejeição FCM/Expo).
 * iOS: som no bundle (ex.: sale_kaching.mp3).
 * Legado `expo`: tratar como Android (canal + sem sound no payload).
 */
export async function notifyAccountNewSale(rows: ExpoPushTokenRow[], opts: SaleNotifyOpts): Promise<void> {
  const { title, body, data } = buildSaleNotification(opts);
  const notificationId =
    typeof data?.notificationId === 'string' && data.notificationId.trim()
      ? data.notificationId.trim()
      : `${data?.type === 'pending_payment' ? 'pending' : 'sale'}:${opts.orderId ?? Date.now()}`;

  const messages: ExpoMessage[] = rows.map((row) => {
    const plat = (row.platform || '').toLowerCase();
    const base: ExpoMessage = {
      to: row.push_token,
      title,
      body,
      data,
      priority: 'high',
      collapseId: notificationId,
      tag: notificationId,
    };
    if (plat === 'android') {
      return { ...base, channelId: 'sales' };
    }
    if (plat === 'ios') {
      return { ...base, sound: 'sale_kaching.mp3' };
    }
    return { ...base, channelId: 'sales' };
  });
  await sendExpoPush(messages);
}
