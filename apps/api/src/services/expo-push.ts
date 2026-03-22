/**
 * Send push notifications via Expo Push API.
 * https://docs.expo.dev/push-notifications/sending-notifications/
 */

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

async function sendExpoPush(messages: ExpoMessage[]): Promise<void> {
  if (messages.length === 0) return;
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
    });
    if (!res.ok) {
      const text = await res.text();
      console.warn('[ExpoPush] Send failed:', res.status, text);
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
