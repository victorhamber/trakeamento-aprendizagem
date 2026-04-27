import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { twMerge } from 'tailwind-merge';
import {
  Line,
  LineChart,
  Pie,
  PieChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';

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

function PeaksTable({
  data,
  textColor,
}: {
  data: PeakData;
  textColor: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[10px] sm:text-xs">
        <thead>
          <tr className="border-b border-zinc-100 dark:border-zinc-800/50">
            <th className="text-left py-1.5 font-medium text-zinc-600 dark:text-zinc-500">Dia</th>
            <th className="text-right py-1.5 font-medium text-zinc-600 dark:text-zinc-500">Pico</th>
          </tr>
        </thead>
        <tbody>
          {data.daily_peaks.map((day) => (
            <tr
              key={day.dow}
              className={twMerge('border-b border-zinc-50 dark:border-white/5 last:border-0', day.is_best_day ? 'bg-zinc-50/80 dark:bg-white/5' : '')}
            >
              <td
                className={twMerge(
                  'py-1.5 pl-1',
                  day.is_best_day ? `${textColor} font-semibold` : 'text-zinc-600 dark:text-zinc-400'
                )}
              >
                {DAYS_SHORT[day.dow]}
                {day.is_best_day && (
                  <span className="ml-1 text-[8px] uppercase tracking-wider opacity-80 border border-current/30 rounded px-1">
                    top
                  </span>
                )}
              </td>
              <td className="py-1.5 pr-1 text-right text-zinc-700 dark:text-zinc-300 tabular-nums">
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
  const pts = useMemo(
    () => data.daily_peaks.map((d, i) => ({ i, v: d.count })),
    [data.daily_peaks]
  );
  if (!pts.some((p) => p.v > 0)) {
    return <div className="h-14 flex items-center justify-center text-[10px] text-zinc-500 italic">Sem série</div>;
  }
  return (
    <div className="h-16 w-full mt-2">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={pts} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <Tooltip
            contentStyle={{
              backgroundColor: 'rgba(9,9,11,0.92)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 8,
              fontSize: 10,
            }}
            labelFormatter={() => 'Volume (melhor janela)'}
            formatter={(v: any) => [String(v), '']}
          />
          <Line type="monotone" dataKey="v" stroke={stroke} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function SourcesBlock({ data }: { data: PeakData }) {
  const rows = useMemo(() => {
    const raw = data.top_sources || [];
    const merged = raw.reduce((acc, src) => {
      const name = formatSource(src.source);
      acc[name] = (acc[name] || 0) + Number(src.count);
      return acc;
    }, {} as Record<string, number>);
    const list = Object.entries(merged)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
    const total = list.reduce((s, [, c]) => s + c, 0);
    return { list, total };
  }, [data.top_sources]);

  if (rows.list.length === 0) {
    return <div className="text-[10px] text-zinc-500 italic py-2">Sem amostra de origem</div>;
  }

  return (
    <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-white/5">
      <div className="text-[9px] font-semibold tracking-widest uppercase text-zinc-600 dark:text-zinc-500 mb-1.5">Origens</div>
      <div className="space-y-1.5">
        {rows.list.map(([name, count], idx) => {
          const pct = rows.total > 0 ? Math.round((count / rows.total) * 1000) / 10 : 0;
          return (
            <div key={idx} className="flex items-center justify-between gap-2 text-[10px] sm:text-xs">
              <span className="text-zinc-600 dark:text-zinc-400 truncate min-w-0">{name}</span>
              <span className="shrink-0 text-zinc-900 dark:text-zinc-100 font-semibold tabular-nums">
                {count}{' '}
                <span className="text-zinc-500 font-medium">({pct}%)</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DeviceDonut({ data }: { data: PeakData }) {
  const chartData = useMemo(() => {
    const slices = data.top_devices || [];
    return slices.map((d) => ({
      name: deviceLabel(d.device),
      key: d.device,
      value: d.count,
    }));
  }, [data.top_devices]);

  const total = chartData.reduce((s, d) => s + d.value, 0);

  if (!chartData.length || total <= 0) {
    return <div className="text-[10px] text-zinc-500 italic py-2">Sem user-agent na amostra</div>;
  }

  return (
    <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-white/5">
      <div className="text-[9px] font-semibold tracking-widest uppercase text-zinc-600 dark:text-zinc-500 mb-2">Dispositivos</div>
      <div className="flex items-center gap-3">
        <div className="h-[100px] w-[100px] shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData as any}
                dataKey="value"
                nameKey="name"
                innerRadius={32}
                outerRadius={48}
                paddingAngle={2}
                stroke="transparent"
              >
                {chartData.map((entry) => (
                  <Cell
                    key={entry.key}
                    fill={
                      entry.key === 'mobile'
                        ? '#22d3ee'
                        : entry.key === 'desktop'
                          ? '#a78bfa'
                          : entry.key === 'tablet'
                            ? '#f59e0b'
                            : '#94a3b8'
                    }
                    stroke="rgba(0,0,0,0.2)"
                    strokeWidth={0.5}
                  />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          {chartData.map((d) => {
            const pct = total > 0 ? Math.round((d.value / total) * 1000) / 10 : 0;
            return (
              <div key={d.key} className="flex items-center justify-between text-[10px] sm:text-xs gap-2">
                <span className="flex items-center gap-1.5 min-w-0">
                  <span
                    className={twMerge('h-1.5 w-1.5 rounded-full shrink-0', DEVICE_RING[d.key] || 'bg-slate-400')}
                  />
                  <span className="text-zinc-600 dark:text-zinc-400 truncate">{d.name}</span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                  {pct}%
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function RegionsBlock({ data }: { data: PeakData }) {
  if (!data.top_locations || data.top_locations.length === 0) {
    return <div className="text-[10px] text-zinc-500 italic py-2">Sem região na amostra</div>;
  }
  const total = data.top_locations.reduce((s, l) => s + Number(l.count), 0);

  return (
    <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-white/5">
      <div className="text-[9px] font-semibold tracking-widest uppercase text-zinc-600 dark:text-zinc-500 mb-1.5">Top regiões</div>
      <div className="space-y-1.5">
        {data.top_locations.map((loc, idx) => {
          const n = Number(loc.count);
          const pct = total > 0 ? Math.round((n / total) * 1000) / 10 : 0;
          const { label, badge } = formatLocationLabel(loc.location);
          return (
            <div key={idx} className="flex items-center justify-between gap-2 text-[10px] sm:text-xs">
              <div className="min-w-0 max-w-[72%] flex items-center gap-1.5">
                <span className="text-zinc-600 dark:text-zinc-400 truncate" title={label}>
                  {label}
                </span>
                {badge === 'pixel' && (
                  <span className="shrink-0 text-[8px] px-1 py-0.5 rounded border border-cyan-500/25 bg-cyan-500/10 text-cyan-800 dark:text-cyan-200">
                    pixel
                  </span>
                )}
              </div>
              <span className="shrink-0 text-zinc-900 dark:text-zinc-100 font-semibold tabular-nums">
                {n} <span className="text-zinc-500 font-medium">({pct}%)</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const Column = ({
  title,
  subtitle,
  data,
  color,
  textColor,
  lineColor,
}: {
  title: string;
  subtitle?: string;
  data: PeakData;
  color: string;
  textColor: string;
  lineColor: string;
}) => {
  const hasPeaks = data.daily_peaks.some((d) => d.count > 0);
  return (
    <div className="neo-card neo-border neo-glow rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-950/45 p-4 sm:p-5 shadow-sm dark:shadow-none h-full flex flex-col select-none">
      <div className="flex items-start gap-2 mb-3 shrink-0">
        <div className={twMerge('w-2 h-2 rounded-full mt-1.5', color)} />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 leading-tight">{title}</h3>
          {subtitle ? <p className="text-[10px] text-zinc-500 mt-0.5 leading-snug">{subtitle}</p> : null}
        </div>
      </div>

      {hasPeaks ? (
        <>
          <div className="text-[9px] font-semibold tracking-widest uppercase text-zinc-600 dark:text-zinc-500 mb-1.5">Picos</div>
          <PeaksTable data={data} textColor={textColor} />
          <PeaksSparkline data={data} stroke={lineColor} />
          <SourcesBlock data={data} />
          <DeviceDonut data={data} />
          <RegionsBlock data={data} />
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center min-h-[220px] text-xs text-zinc-500 italic">Sem dados suficientes</div>
      )}
    </div>
  );
};

export function BestTimeCards({ siteId, period = 'last_30d' }: BestTimeCardsProps) {
  const [data, setData] = useState<BestTimesData | null>(null);
  const [loading, setLoading] = useState(true);

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

  if (loading)
    return (
      <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="neo-card neo-border neo-glow rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-950/45 p-5 h-[360px] animate-pulse"
          >
            <div className="h-4 w-32 bg-zinc-200 dark:bg-zinc-800 rounded mb-4" />
            <div className="space-y-3">
              {[...Array(7)].map((_, j) => (
                <div key={j} className="h-3 w-full bg-zinc-100 dark:bg-zinc-800/50 rounded" />
              ))}
            </div>
          </div>
        ))}
      </div>
    );

  const emptyData: PeakData = { daily_peaks: [], total_volume: 0, top_devices: [] };

  return (
    <div className="mb-6">
      <div className="mb-4">
        <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Análises detalhadas</h3>
        <p className="text-[11px] text-zinc-500 mt-0.5 leading-relaxed max-w-3xl">
          Picos, origens, dispositivo e região por estágio do funil (base: {PERIOD_LABELS[period] || '30 dias'}). {bestTimesTzNote(data?.report_timezone)}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 items-stretch">
        <Column
          title="PageView"
          subtitle="Janela com mais volume por dia da semana + contexto (origem, device, região)."
          data={data?.pageview || emptyData}
          color="bg-violet-500"
          textColor="text-violet-600 dark:text-violet-300"
          lineColor="#a78bfa"
        />
        <Column
          title="Lead"
          subtitle="Inclui Lead, cadastro e intenção declarada (quando existir no tracking)."
          data={data?.lead || emptyData}
          color="bg-cyan-500"
          textColor="text-cyan-700 dark:text-cyan-300"
          lineColor="#22d3ee"
        />
        <Column
          title="InitiateCheckout"
          subtitle="Apenas InitiateCheckout (início de checkout), sem carrinho genérico."
          data={data?.checkout || emptyData}
          color="bg-amber-500"
          textColor="text-amber-600 dark:text-amber-300"
          lineColor="#fbbf24"
        />
        <Column
          title="Compras (Purchase)"
          subtitle="Amostra de compras aprovadas: origem/UA vêm do que chegou no evento/integração."
          data={data?.purchase || emptyData}
          color="bg-emerald-500"
          textColor="text-emerald-600 dark:text-emerald-300"
          lineColor="#34d399"
        />
      </div>
    </div>
  );
}
