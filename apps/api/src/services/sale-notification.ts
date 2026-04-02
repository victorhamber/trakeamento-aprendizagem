/** Texto e payload compartilhados entre Expo Push e Web Push (vendas). */

/** `pending_payment` = boleto/PIX aguardando pagamento (não é venda liquidada). */
export type SaleNotifyKind = 'sale' | 'pending_payment';

export type SaleNotifyOpts = {
  amount?: number;
  currency?: string;
  orderId?: string;
  platform?: string;
  productName?: string;
  /** Default: venda aprovada/liquidada */
  notifyKind?: SaleNotifyKind;
  /**
   * Só usado com `pending_payment`. Se null e método desconhecido, título neutro.
   * @see inferPaymentMethodFromPayload no webhook
   */
  pendingPaymentKind?: 'pix' | 'boleto' | null;
};

export function buildSaleNotification(opts: SaleNotifyOpts) {
  const { amount, currency, orderId, platform, productName, notifyKind = 'sale', pendingPaymentKind = null } = opts;
  const isPending = notifyKind === 'pending_payment';

  const valueStr =
    amount != null && currency
      ? new Intl.NumberFormat('pt-BR', {
          style: 'currency',
          currency: currency.toUpperCase(),
        }).format(Number(amount))
      : 'Nova venda';

  const title = !isPending
    ? '💰 Venda recebida'
    : pendingPaymentKind === 'pix'
      ? '💳 PIX gerado'
      : pendingPaymentKind === 'boleto'
        ? '📄 Boleto gerado'
        : '⏳ Pagamento pendente';

  const body =
    amount != null && currency
      ? `${valueStr}${productName ? `\n📦 ${productName}` : platform ? ` (${platform})` : ''}`
      : orderId
        ? `Pedido ${orderId}${productName ? `\n📦 ${productName}` : platform ? ` · ${platform}` : ''}`
        : 'Confira no painel.';

  const data: Record<string, unknown> = {
    type: isPending ? 'pending_payment' : 'sale',
    orderId: orderId ?? null,
    amount: amount ?? null,
    currency: currency ?? null,
    platform: platform ?? null,
    ...(isPending ? { pending_payment_method: pendingPaymentKind } : {}),
  };

  return { title, body, data };
}
