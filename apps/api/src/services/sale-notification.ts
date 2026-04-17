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
  const { amount, currency, orderId, platform, notifyKind = 'sale', pendingPaymentKind = null } = opts;
  const isPending = notifyKind === 'pending_payment';

  const productName = opts.productName ? opts.productName.replace(/📦\s*/g, '').trim() : undefined;

  const valueStr =
    amount != null && currency
      ? new Intl.NumberFormat('pt-BR', {
          style: 'currency',
          currency: currency.toUpperCase(),
        }).format(Number(amount))
      : 'Nova venda';

  const title = 'Trajettu';

  const primaryLine = !isPending
    ? amount != null && currency
      ? `Nova venda aprovada • ${valueStr}`
      : 'Nova venda aprovada'
    : pendingPaymentKind === 'pix'
      ? amount != null && currency
        ? `PIX gerado • ${valueStr}`
        : 'PIX gerado'
      : pendingPaymentKind === 'boleto'
        ? amount != null && currency
          ? `Boleto gerado • ${valueStr}`
          : 'Boleto gerado'
        : amount != null && currency
          ? `Pagamento pendente • ${valueStr}`
          : 'Pagamento pendente';

  const secondaryLine = productName
    ? productName
    : orderId
      ? `Pedido ${orderId}${platform ? ` • ${platform}` : ''}`
      : platform || 'Abra o app para ver os detalhes';

  const body = [primaryLine, secondaryLine].filter(Boolean).join('\n');

  const data: Record<string, unknown> = {
    type: isPending ? 'pending_payment' : 'sale',
    notificationId: `${isPending ? 'pending' : 'sale'}:${orderId ?? Date.now()}`,
    orderId: orderId ?? null,
    amount: amount ?? null,
    currency: currency ?? null,
    platform: platform ?? null,
    ...(isPending ? { pending_payment_method: pendingPaymentKind } : {}),
  };

  return { title, body, data };
}
