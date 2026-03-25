/** Texto e payload compartilhados entre Expo Push e Web Push (vendas). */

export type SaleNotifyOpts = {
  amount?: number;
  currency?: string;
  orderId?: string;
  platform?: string;
  productName?: string;
};

export function buildSaleNotification(opts: SaleNotifyOpts) {
  const { amount, currency, orderId, platform, productName } = opts;
  const valueStr =
    amount != null && currency
      ? new Intl.NumberFormat('pt-BR', {
          style: 'currency',
          currency: currency.toUpperCase(),
        }).format(Number(amount))
      : 'Nova venda';

  const title = '💰 Venda recebida';
  const body =
    amount != null && currency
      ? `${valueStr}${productName ? `\n📦 ${productName}` : platform ? ` (${platform})` : ''}`
      : orderId
        ? `Pedido ${orderId}${productName ? `\n📦 ${productName}` : platform ? ` · ${platform}` : ''}`
        : 'Confira no painel.';

  const data: Record<string, unknown> = {
    type: 'sale',
    orderId: orderId ?? null,
    amount: amount ?? null,
    currency: currency ?? null,
    platform: platform ?? null,
  };

  return { title, body, data };
}
