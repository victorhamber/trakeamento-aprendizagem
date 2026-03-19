/**
 * Send push notifications via Expo Push API.
 * https://docs.expo.dev/push-notifications/sending-notifications/
 */

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default' | null;
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
  opts: { amount?: number; currency?: string; orderId?: string; platform?: string }
): Promise<void> {
  const { amount, currency, orderId, platform } = opts;
  const valueStr =
    amount != null && currency
      ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency.toUpperCase() }).format(Number(amount))
      : 'Nova venda';
  const title = '💰 Venda recebida';
  const body =
    amount != null && currency
      ? `${valueStr}${platform ? ` (${platform})` : ''}`
      : orderId
        ? `Pedido ${orderId}${platform ? ` · ${platform}` : ''}`
        : 'Confira no app.';

  const messages: ExpoMessage[] = pushTokens.map((t) => ({
    to: t.push_token,
    title,
    body,
    data: { type: 'sale', orderId, amount, currency },
    sound: 'default',
    priority: 'high',
  }));
  await sendExpoPush(messages);
}
