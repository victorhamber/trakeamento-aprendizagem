import type { ReactNode } from 'react';
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  Check,
  ChevronRight,
  Code2,
  Flag,
  Info,
  Megaphone,
  Play,
  ShoppingBag,
  Smartphone,
  Tag,
  Users,
  X,
} from 'lucide-react';

const border = 'border-zinc-800';
const cardBg = 'bg-zinc-900';
const muted = 'text-slate-400';
const text = 'text-slate-100';

export function initialsFromName(name: string): string {
  const p = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!p.length) return '?';
  if (p.length === 1) return p[0].slice(0, 2).toUpperCase();
  return `${p[0][0] || ''}${p[p.length - 1][0] || ''}`.toUpperCase();
}

export function JourneyModalFrame({
  onClose,
  header,
  children,
}: {
  onClose: () => void;
  header: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      <button type="button" className="absolute inset-0 bg-black/75 backdrop-blur-[2px]" onClick={onClose} aria-label="Fechar" />
      <div className="relative w-full max-w-6xl">
        <div
          className={`rounded-2xl ${border} border bg-zinc-950 shadow-2xl overflow-hidden max-h-[calc(100vh-40px)] flex flex-col ${text}`}
        >
          {header}
          <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-5">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function JourneyModalHeader({
  initials,
  name,
  subtitle,
  badge,
  onClose,
}: {
  initials: string;
  name: string;
  subtitle: string;
  badge?: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className={`flex items-start justify-between gap-4 px-4 sm:px-5 py-4 border-b ${border} ${cardBg}`}>
      <div className="flex items-start gap-3 min-w-0">
        <div className="h-11 w-11 rounded-full bg-indigo-500 flex items-center justify-center text-sm font-bold text-white shrink-0 shadow-lg shadow-indigo-500/20">
          {initials}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 gap-y-1">
            <h2 className="text-base font-semibold text-white truncate">{name}</h2>
            {badge}
          </div>
          <p className={`text-xs ${muted} mt-0.5 leading-relaxed`}>{subtitle}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        className={`shrink-0 inline-flex items-center gap-1.5 rounded-lg ${border} border px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/5 transition-colors`}
      >
        <X className="h-3.5 w-3.5" strokeWidth={2} />
        Fechar
      </button>
    </div>
  );
}

export function StatusPill({ children, variant = 'success' }: { children: ReactNode; variant?: 'success' | 'info' | 'warning' }) {
  const cls =
    variant === 'success'
      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25'
      : variant === 'warning'
        ? 'bg-amber-500/15 text-amber-200 border-amber-500/25'
        : 'bg-sky-500/15 text-sky-200 border-sky-500/25';
  const icon =
    variant === 'success' ? (
      <Check className="h-3 w-3 shrink-0" strokeWidth={2.5} aria-hidden />
    ) : variant === 'info' ? (
      <Check className="h-3 w-3 shrink-0 opacity-90" strokeWidth={2.5} aria-hidden />
    ) : variant === 'warning' ? (
      <AlertTriangle className="h-3 w-3 shrink-0" strokeWidth={2.5} aria-hidden />
    ) : null;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${cls}`}>
      {icon}
      {children}
    </span>
  );
}

export function MetricCard({
  icon: Icon,
  iconClass,
  label,
  value,
}: {
  icon: typeof ShoppingBag;
  iconClass: string;
  label: string;
  value: ReactNode;
}) {
  return (
    <div className={`rounded-xl ${border} border ${cardBg} p-3 flex gap-3`}>
      <div className={`shrink-0 rounded-lg p-2 ${iconClass}`}>
        <Icon className="h-4 w-4" strokeWidth={2} />
      </div>
      <div className="min-w-0">
        <div className={`text-[10px] font-semibold uppercase tracking-wide ${muted}`}>{label}</div>
        <div className="mt-0.5 text-sm font-semibold text-white truncate">{value}</div>
      </div>
    </div>
  );
}

export function MetricGrid4({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">{children}</div>;
}

export function OriginSaleCard({
  heading = 'Origem da venda',
  campaign,
  adset,
  ad,
  footerNote,
}: {
  heading?: string;
  campaign: string;
  adset: string;
  ad: string;
  footerNote: string;
}) {
  const col = (Icon: typeof Flag, label: string, value: string) => (
    <div className="min-w-0">
      <div className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide ${muted}`}>
        <Icon className="h-3 w-3 shrink-0" strokeWidth={2} />
        {label}
      </div>
      <div className="mt-1 text-sm font-medium text-white truncate" title={value}>
        {value || '—'}
      </div>
    </div>
  );
  return (
    <div className={`rounded-xl ${border} border ${cardBg} p-4`}>
      <div className="text-xs font-semibold text-slate-200 mb-3">{heading}</div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {col(Flag, 'Campanha', campaign)}
        {col(Users, 'Conjunto', adset)}
        {col(Play, 'Anúncio', ad)}
      </div>
      <div className={`mt-3 flex items-start gap-2 text-[11px] ${muted}`}>
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-slate-500" />
        <span>{footerNote}</span>
      </div>
    </div>
  );
}

export type JourneyUniquePath = {
  steps: string[];
  footer: string;
  variant: 'purchase' | 'lead';
};

function UniquePathStrip({ steps, footer, variant }: JourneyUniquePath) {
  if (!steps.length) return null;
  const lastIdx = steps.length - 1;
  return (
    <div className="mb-5 pb-5 border-b border-slate-800/80">
      <div className={`text-[10px] font-semibold uppercase tracking-wide ${muted} mb-1`}>Resumo do funil</div>
      <p className={`text-[11px] ${muted} mb-3 leading-relaxed`}>
        {variant === 'purchase'
          ? 'Ordem das páginas na primeira vez em que aparecem (sem repetir). Abaixo, cada visita com data e detalhes — inclusive quando a mesma página é acessada mais de uma vez.'
          : 'Ordem dos passos únicos até o formulário. Abaixo, o histórico cronológico de cada página vista.'}
      </p>
      <div className="flex flex-wrap items-center gap-1 justify-center">
        {steps.map((s, i) => {
          const highlight =
            variant === 'purchase' ? s === 'Compra' : i === lastIdx && s === 'Lead';
          return (
            <span key={`${s}-${i}`} className="flex items-center gap-1">
              {i > 0 ? <ChevronRight className="h-3.5 w-3.5 text-slate-600 shrink-0" /> : null}
              <span
                className={
                  highlight
                    ? 'inline-flex rounded-lg border border-emerald-500/35 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-200'
                    : 'inline-flex rounded-lg border border-slate-600/50 bg-slate-800/60 px-2.5 py-1 text-[11px] font-medium text-slate-200'
                }
              >
                {s}
              </span>
            </span>
          );
        })}
      </div>
      <div className={`text-center text-[11px] ${muted} mt-3`}>{footer}</div>
    </div>
  );
}

const timelineIconMap = {
  book: BookOpen,
  check: Check,
  tag: Tag,
  chart: BarChart3,
} as const;

export type TimelineIconKind = keyof typeof timelineIconMap;

/** Segmentos de URL típicos de oferta, checkout e pós-conversão (PT/EN comuns em funis). */
const TIMELINE_TAG_SEGMENTS = new Set([
  'oferta',
  'ofertas',
  'liberada',
  'liberado',
  'checkout',
  'carrinho',
  'cart',
  'pagamento',
  'pagar',
  'pix',
  'boleto',
  'assinatura',
  'compra',
  'comprar',
  'pedido',
  'order',
  'orders',
  'obrigado',
  'obrigada',
  'thanks',
  'thankyou',
  'upsell',
  'downsell',
  'oto',
  'bump',
  'vendas',
  'venda',
  'vsl',
  'pitch',
  'captura',
  'inscricao',
  'aplicacao',
  'fechamento',
  'promocao',
  'lancamento',
  'sales',
  'payment',
  'offer',
  'finalizar',
  'sucesso',
  'upgrade',
  'crosssell',
  'pay',
  'buy',
  'shop',
]);

/** Padrões compostos no slug completo (hífen preservado no texto). */
const TIMELINE_TAG_COMPOUND_RE =
  /thank-you|order-bump|orderbump|black-friday|pagina-vendas|video-vendas|confirmar-pagamento|pagina-obrigado|check-out/i;

/**
 * Heurística: primeira visita (livro), marcos de oferta/checkout/tag (tag), demais (gráfico).
 * Usa segmentos do slug para evitar falsos positivos (ex.: “comprador” ≠ “compra”).
 */
export function timelineIconFromPageSlug(slug: string, idx: number): TimelineIconKind {
  const s = (slug || '').trim().toLowerCase();
  if (idx === 0) return 'book';
  if (!s) return 'chart';
  if (TIMELINE_TAG_COMPOUND_RE.test(s)) return 'tag';
  const segments = s.split(/[-_/]+/).filter(Boolean);
  if (segments.some((seg) => TIMELINE_TAG_SEGMENTS.has(seg))) return 'tag';
  return 'chart';
}

export type TimelineItem = {
  at: string;
  title: string;
  subtitle?: string;
  highlight?: boolean;
  /** Ícone do marco (referência: livro, tag, gráfico, check na conversão). */
  icon?: TimelineIconKind;
};

export function JourneyTimeline({
  title,
  items,
  uniquePath,
}: {
  title: string;
  items: TimelineItem[];
  /** Passos únicos (funil) no topo do mesmo card; a lista abaixo é o detalhe cronológico. */
  uniquePath?: JourneyUniquePath | null;
}) {
  return (
    <div className={`rounded-xl ${border} border ${cardBg} p-4`}>
      <div className="text-xs font-semibold text-slate-200 mb-3">{title}</div>
      {uniquePath ? <UniquePathStrip {...uniquePath} /> : null}
      {items.length === 0 ? (
        <div className={`text-sm ${muted}`}>Nenhum evento na linha do tempo ainda.</div>
      ) : (
        <>
          {uniquePath ? (
            <div className={`text-[10px] font-semibold uppercase tracking-wide ${muted} mb-3`}>Visitas e marcos</div>
          ) : null}
          <ul className="relative space-y-0">
            {items.map((it, idx) => {
              const kind: TimelineIconKind = it.highlight ? 'check' : it.icon ?? 'chart';
              const Icon = timelineIconMap[kind];
              const iconWrap = it.highlight
                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200 shadow-[0_0_14px_rgba(52,211,153,0.35)]'
                : 'border-slate-600/55 bg-slate-800/90 text-indigo-200';
              return (
                <li key={`${it.at}-${idx}`} className="relative flex gap-3 pb-6 last:pb-0">
                  <div className="flex flex-col items-center shrink-0 w-9">
                    <div
                      className={`h-9 w-9 rounded-lg flex items-center justify-center border ${iconWrap}`}
                      aria-hidden
                    >
                      <Icon className="h-4 w-4" strokeWidth={2} />
                    </div>
                    {idx < items.length - 1 ? (
                      <div className="w-px flex-1 min-h-[22px] bg-slate-700/85 mt-1.5" />
                    ) : null}
                  </div>
                  <div className="min-w-0 pt-1">
                    <div className={`text-[10px] font-medium tabular-nums ${muted}`}>{it.at}</div>
                    <div className={`text-sm font-medium ${it.highlight ? 'text-emerald-200' : 'text-white'}`}>{it.title}</div>
                    {it.subtitle ? <div className={`text-[11px] ${muted} mt-0.5`}>{it.subtitle}</div> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

export function TopPagesGradientBars({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; count: number }[];
}) {
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <div className={`rounded-xl ${border} border ${cardBg} p-4`}>
      <div className="text-xs font-semibold text-slate-200 mb-3">{title}</div>
      <div className="space-y-2.5">
        {rows.slice(0, 8).map((r) => (
          <div key={r.label}>
            <div className="flex justify-between gap-2 text-[11px] mb-1">
              <span className="truncate text-slate-300 font-medium" title={r.label}>
                {r.label}
              </span>
              <span className="tabular-nums font-semibold text-indigo-300 shrink-0">{r.count}</span>
            </div>
            <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-sky-500 via-indigo-500 to-violet-500"
                style={{ width: `${Math.max(8, (r.count / max) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LastAdPanel({
  platform,
  origin,
  campaign,
  content,
  audience,
}: {
  platform: string;
  origin: string;
  campaign: string;
  content: string;
  audience: string;
}) {
  const Row = ({ icon: Icon, label, value }: { icon: typeof Megaphone; label: string; value: string }) => (
    <div className="flex items-start gap-2.5 py-2 border-b border-slate-800/80 last:border-0">
      <Icon className="h-4 w-4 text-slate-500 shrink-0 mt-0.5" strokeWidth={2} />
      <div className="min-w-0 flex-1">
        <div className={`text-[10px] font-semibold uppercase tracking-wide ${muted}`}>{label}</div>
        <div className="text-sm font-medium text-white truncate" title={value}>
          {value || '—'}
        </div>
      </div>
    </div>
  );
  return (
    <div className={`rounded-xl ${border} border ${cardBg} p-4`}>
      <div className="text-xs font-semibold text-slate-200 mb-1">Último anúncio detectado</div>
      <p className={`text-[10px] ${muted} mb-2 leading-relaxed`}>
        Valores do último clique com parâmetros de anúncio disponíveis (Meta ou UTM).
      </p>
      <div className="divide-y divide-slate-800/80">
        <Row icon={Megaphone} label="Plataforma" value={platform} />
        <Row icon={BarChart3} label="Origem" value={origin} />
        <Row icon={Flag} label="Campanha" value={campaign} />
        <Row icon={Play} label="Conteúdo" value={content} />
        <Row icon={Users} label="Público" value={audience} />
      </div>
    </div>
  );
}

export function TechnicalAccordion({ children }: { children: ReactNode }) {
  return (
    <details className={`rounded-xl ${border} border ${cardBg} group`}>
      <summary className="cursor-pointer list-none flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-3 text-sm font-medium text-slate-200 hover:bg-white/[0.03] rounded-xl">
        <Code2 className="h-4 w-4 text-slate-400 shrink-0" />
        <span className="shrink-0">Ver dados técnicos</span>
        <span className={`text-xs font-normal ${muted} basis-full sm:basis-auto sm:pl-0 pl-7`}>
          IDs, parâmetros UTM, user agent e outros detalhes técnicos.
        </span>
      </summary>
      <div className="px-4 pb-4 pt-0 border-t border-slate-800/80">{children}</div>
    </details>
  );
}

export { ShoppingBag, Megaphone, BarChart3, Smartphone };
