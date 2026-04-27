import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { twMerge } from 'tailwind-merge';
import { Line, LineChart, Pie, PieChart, Cell, ResponsiveContainer, Tooltip } from 'recharts';

type DailyPeak = {
  dow: number;
  hour: number | null;
  count: number;
  is_best_day: boolean;
};

type DeviceSlice = { device: string; count: number };

type PeakData = {
  daily_peaks: DailyPeak[];
  total_volume: number;
  top_sources?: { source: string; count: number }[];
  top_locations?: { location: string; count: number }[];
  top_devices?: DeviceSlice[];
};

type BestTimesData = {
  pageview: PeakData;
  purchase: PeakData;
  lead: PeakData;
  checkout: PeakData;
  report_timezone?: string;
};

type TabId = 'pageview' | 'lead' | 'checkout' | 'purchase';

function bestTimesTzNote(tz?: string) {
  if (!tz || tz === 'America/Sao_Paulo') return 'Horários no fuso de Brasília (para alinhar com Meta).';
  return `Horários no fuso ${tz.replace(/_/g, ' ')}.`;
}

interface BestTimeCardsProps {
  siteId?: number;
  period?: string;
}

const DAYS_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const PERIOD_LABELS: Record<string, string> = {
  today: 'Hoje',
  yesterday: 'Ontem',
  last_7d: '7 dias',
  last_14d: '14 dias',
  last_30d: '30 dias',
  maximum: 'Máximo',
};

const TABS: { id: TabId; label: string; lineColor: string; textColor: string; dot: string }[] = [
  { id: 'pageview', label: 'PageView', lineColor: '#a78bfa', textColor: 'text-violet-600 dark:text-violet-300', dot: 'bg-violet-500' },
  { id: 'lead', label: 'Lead', lineColor: '#22d3ee', textColor: 'text-cyan-600 dark:text-cyan-300', dot: 'bg-cyan-500' },
  { id: 'checkout', label: 'InitiateCheckout', lineColor: '#fbbf24', textColor: 'text-amber-600 dark:text-amber-300', dot: 'bg-amber-500' },
  { id: 'purchase', label: 'Compras', lineColor: '#34d399', textColor: 'text-emerald-600 dark:text-emerald-300', dot: 'bg-emerald-500' },
];

function displayRegionNamePtBr(iso2: string): string | null {
  try {
    const AnyIntl = Intl as any;
    if (!AnyIntl?.DisplayNames) return null;
    const dn = new AnyIntl.DisplayNames('pt-BR', { type: 'region' });
    const out = dn.of(iso2);
    return typeof out === 'string' ? out : null;
  } catch {
    return null;
  }
}

function formatLocationLabel(raw: string): { label: string; badge?: 'pixel' | 'ip' } {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return { label: '—' };

  const hasPixelBadge = /\s*·\s*pixel\s*$/i.test(trimmed);
  const base = hasPixelBadge ? trimmed.replace(/\s*·\s*pixel\s*$/i, '').trim() : trimmed;

  if (/^[A-Z]{2}$/.test(base)) {
    const name = displayRegionNamePtBr(base);
    return { label: name ? `${name} (${base})` : base, badge: hasPixelBadge ? 'pixel' : undefined };
  }

  return { label: base, badge: hasPixelBadge ? 'pixel' : undefined };
}

function formatSource(rawSource: string) {
  if (!rawSource || rawSource.toLowerCase().includes('direct') || rawSource.toLowerCase().includes('unknown')) {
    return 'Direto / Orgânico';
  }

  try {
    const source = decodeURIComponent(rawSource).trim().toLowerCase();

    if (source === 'ig' || source === 'instagram') return 'Instagram';
    if (source === 'fb' || source === 'facebook') return 'Facebook';
    if (source === 'tk' || source === 'tiktok') return 'TikTok';
    if (source === 'yt' || source === 'youtube') return 'YouTube';
    if (source === 'google' || source === 'gads') return 'Google';

    const url = new URL(source.startsWith('http') ? source : `https://${source}`);
    let host = url.hostname.replace(/^www\./, '');

    if (host.includes('instagram.com')) return 'Instagram';
    if (host.includes('facebook.com')) return 'Facebook';
    if (host.includes('youtube.com')) return 'YouTube';
    if (host.includes('tiktok.com')) return 'TikTok';
    if (host.includes('google.com')) return 'Google';

    return host;
  } catch {
    try {
      const decodedFallback = decodeURIComponent(rawSource).trim();
      const lw = decodedFallback.toLowerCase();
      if (lw === 'ig' || lw === 'instagram') return 'Instagram';
      if (lw === 'fb' || lw === 'facebook') return 'Facebook';
      return decodedFallback;
    } catch {
      return rawSource;
    }
  }
}

const DEVICE_LABEL: Record<string, string> = {
  mobile: 'Mobile',
  tablet: 'Tablet',
  desktop: 'Desktop',
  unknown: 'Outros',
};

const DEVICE_RING: Record<string, string> = {
  mobile: 'bg-cyan-400',
  desktop: 'bg-violet-400',
  tablet: 'bg-amber-400',
  unknown: 'bg-slate-400',
};

function deviceLabel(k: string) {
  return DEVICE_LABEL[k] || k;
}

function PeaksTable({ data, textColor }: { data: PeakData; textColor: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[10px] sm:text-xs">
        <thead>
          <tr className="border-b border-zinc-200 dark:border-zinc-800/50">
            <th className="text-left py-1.5 font-medium text-zinc-600 dark:text-zinc-500">Dia</th>
            <th className="text-right py-1.5 font-medium text-zinc-600 dark:text-zinc-500">Melhor horário</th>
          </tr>
        </thead>
        <tbody>
          {data.daily_peaks.map((day) => (
            <tr
              key={day.dow}
              className={twMerge('border-b border-zinc-50 dark:border-white/5 last:border-0', day.is_best_day ? 'bg-zinc-50/80 dark:bg-white/5' : '')}
            >
              <td
                className={twMerge('py-1.5 pl-0', day.is_best_day ? `${textColor} font-semibold` : 'text-zinc-600 dark:text-zinc-400')}
              >
                {DAYS_SHORT[day.dow]}
                {day.is_best_day && (
                  <span className="ml-1 text-[8px] uppercase tracking-wider opacity-80 border border-current/30 rounded px-1">top</span>
                )}
              </td>
              <td className="py-1.5 pr-0 text-right text-zinc-700 dark:text-zinc-300 tabular-nums">
                {day.hour !== null ? `${day.hour}h - ${day.hour + 1}h` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PeaksSparkline({ data, stroke }: { data: PeakData; stroke: string }) {
  const pts = useMemo(() => data.daily_peaks.map((d, i) => ({ i, v: d.count })), [data.daily_peaks]);
  if (!pts.some((p) => p.v > 0)) {
    return <div className="h-14 flex items-center justify-center text-[10px] text-zinc-500 italic">Sem série</div>;
  }
  return (
    <div className="h-20 w-full mt-3">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={pts} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
          <Tooltip
            contentStyle={{
              backgroundColor: 'rgba(9,9,11,0.92)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 8,
              fontSize: 10,
            }}
            labelFormatter={() => 'Volume'}
            formatter={(v: any) => [String(v), '']}
          />
          <Line type="monotone" dataKey="v" stroke={stroke} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function SourcesList({ data }: { data: PeakData }) {
  const rows = useMemo(() => {
    const raw = data.top_sources || [];
    const merged = raw.reduce(
      (acc, src) => {
        const name = formatSource(src.source);
        acc[name] = (acc[name] || 0) + Number(src.count);
        return acc;
      },
      {} as Record<string, number>
    );
    const list = Object.entries(merged)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    const total = list.reduce((s, [, c]) => s + c, 0);
    return { list, total };
  }, [data.top_sources]);

  if (rows.list.length === 0) {
    return <p className="text-xs text-zinc-500 italic py-2">Sem amostra de origem no período.</p>;
  }

  return (
    <ul className="space-y-2.5">
      {rows.list.map(([name, count], idx) => {
        const pct = rows.total > 0 ? Math.round((count / rows.total) * 1000) / 10 : 0;
        return (
          <li key={idx} className="flex items-center justify-between gap-2 text-xs sm:text-sm">
            <span className="text-zinc-600 dark:text-zinc-300 truncate min-w-0">{name}</span>
            <span className="shrink-0 font-semibold text-zinc-900 dark:text-zinc-100 tabular-nums">
              {count} <span className="text-zinc-500 font-medium text-[11px]">({String(pct).replace('.', ',')}%)</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function DeviceDonutBlock({ data }: { data: PeakData }) {
  const chartData = useMemo(() => {
    return (data.top_devices || []).map((d) => ({
      name: deviceLabel(d.device),
      key: d.device,
      value: d.count,
    }));
  }, [data.top_devices]);

  const total = chartData.reduce((s, d) => s + d.value, 0);
  if (!chartData.length || total <= 0) {
    return <p className="text-xs text-zinc-500 italic py-2">Sem user-agent na amostra.</p>;
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-4">
      <div className="h-[120px] w-[120px] mx-auto sm:mx-0 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={chartData as any} dataKey="value" nameKey="name" innerRadius={36} outerRadius={54} paddingAngle={2} stroke="transparent">
              {chartData.map((entry) => (
                <Cell
                  key={entry.key}
                  fill={entry.key === 'mobile' ? '#22d3ee' : entry.key === 'desktop' ? '#a78bfa' : entry.key === 'tablet' ? '#f59e0b' : '#94a3b8'}
                  stroke="rgba(0,0,0,0.2)"
                  strokeWidth={0.5}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="min-w-0 flex-1 space-y-2">
        {chartData.map((d) => {
          const pct = total > 0 ? Math.round((d.value / total) * 1000) / 10 : 0;
          return (
            <li key={d.key} className="flex items-center justify-between text-xs sm:text-sm gap-2">
              <span className="flex items-center gap-2 min-w-0">
                <span className={twMerge('h-2 w-2 rounded-full shrink-0', DEVICE_RING[d.key] || 'bg-slate-400')} />
                <span className="text-zinc-600 dark:text-zinc-300 truncate">{d.name}</span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{String(pct).replace('.', ',')}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function RegionsList({ data }: { data: PeakData }) {
  if (!data.top_locations || data.top_locations.length === 0) {
    return <p className="text-xs text-zinc-500 italic py-2">Sem região na amostra.</p>;
  }
  const total = data.top_locations.reduce((s, l) => s + Number(l.count), 0);
  return (
    <ul className="space-y-2.5">
      {data.top_locations.map((loc, idx) => {
        const n = Number(loc.count);
        const pct = total > 0 ? Math.round((n / total) * 1000) / 10 : 0;
        const { label, badge } = formatLocationLabel(loc.location);
        return (
          <li key={idx} className="flex items-center justify-between gap-2 text-xs sm:text-sm">
            <div className="min-w-0 flex items-center gap-1.5 max-w-[70%]">
              <span className="text-zinc-600 dark:text-zinc-300 truncate" title={label}>
                {label}
              </span>
              {badge === 'pixel' && (
                <span className="shrink-0 text-[9px] px-1 py-0.5 rounded border border-cyan-500/30 bg-cyan-500/10 text-cyan-800 dark:text-cyan-200">
                  pixel
                </span>
              )}
            </div>
            <span className="shrink-0 font-semibold text-zinc-900 dark:text-zinc-100 tabular-nums">
              {n} <span className="text-zinc-500 font-medium text-[11px]">({String(pct).replace('.', ',')}%)</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function MetricPanel({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="neo-card rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-950/50 p-4 sm:p-5 flex flex-col h-full min-h-[240px] shadow-sm dark:shadow-none">
      <div>
        <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h4>
        <p className="text-[11px] text-zinc-500 dark:text-zinc-500 mt-0.5">{subtitle}</p>
      </div>
      <div className="mt-4 flex-1 min-h-0 flex flex-col">{children}</div>
    </div>
  );
}

function getPeakForTab(data: BestTimesData | null, tab: TabId): PeakData {
  const empty: PeakData = { daily_peaks: [], total_volume: 0, top_devices: [] };
  if (!data) return empty;
  switch (tab) {
    case 'pageview':
      return data.pageview || empty;
    case 'lead':
      return data.lead || empty;
    case 'checkout':
      return data.checkout || empty;
    case 'purchase':
      return data.purchase || empty;
    default:
      return empty;
  }
}

export function BestTimeCards({ siteId, period = 'last_30d' }: BestTimeCardsProps) {
  const [data, setData] = useState<BestTimesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabId>('pageview');

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const params = new URLSearchParams();
        if (siteId) params.append('siteId', String(siteId));
        params.append('period', period);
        const res = await api.get(`/stats/best-times?${params.toString()}`);
        setData(res.data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [siteId, period]);

  const current = TABS.find((t) => t.id === tab)!;
  const peak = getPeakForTab(data, tab);
  const hasAnyPeak = peak.daily_peaks.some((d) => d.count > 0);

  if (loading) {
    return (
      <div className="mb-6">
        <div className="h-10 w-64 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse mb-4" />
        <div className="h-9 max-w-md bg-zinc-100 dark:bg-zinc-800/80 rounded-lg animate-pulse mb-6" />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-[300px] rounded-2xl bg-zinc-100 dark:bg-zinc-800/50 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mb-6">
      <div className="mb-5">
        <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">Análise de dados</h3>
        <p className="text-sm text-zinc-500 dark:text-zinc-500 mt-1 max-w-2xl leading-relaxed">
          Descubra de onde vêm suas conversões e quais canais mais performam. Base: {PERIOD_LABELS[period] || 'período'}. {bestTimesTzNote(data?.report_timezone)}
        </p>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={twMerge(
              'inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all border',
              tab === t.id
                ? 'bg-zinc-100 dark:bg-white/10 border-cyan-500/50 text-zinc-900 dark:text-zinc-50 shadow-sm'
                : 'bg-transparent border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-white/20'
            )}
          >
            <span className={twMerge('h-2 w-2 rounded-full', t.dot)} />
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricPanel title="Picos de conversão" subtitle="Melhores horários do dia">
          {hasAnyPeak ? (
            <>
              <PeaksTable data={peak} textColor={current.textColor} />
              <PeaksSparkline data={peak} stroke={current.lineColor} />
            </>
          ) : (
            <p className="text-sm text-zinc-500 italic flex-1 flex items-center">Sem dados suficientes para picos.</p>
          )}
        </MetricPanel>

        <MetricPanel title="Origens de tráfego" subtitle="Top origens">
          <SourcesList data={peak} />
        </MetricPanel>

        <MetricPanel title="Dispositivos" subtitle="Conversões por dispositivo (amostra)">
          <DeviceDonutBlock data={peak} />
        </MetricPanel>

        <MetricPanel title="Top regiões" subtitle="Conversões por região">
          <RegionsList data={peak} />
        </MetricPanel>
      </div>
    </div>
  );
}
