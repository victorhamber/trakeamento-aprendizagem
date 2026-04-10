import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { twMerge } from 'tailwind-merge';

type DailyPeak = {
  dow: number;
  hour: number | null;
  count: number;
  is_best_day: boolean;
};

type PeakData = {
  daily_peaks: DailyPeak[];
  total_volume: number;
  top_sources?: { source: string; count: number }[];
  top_locations?: { location: string; count: number }[];
};

type BestTimesData = {
  purchase: PeakData;
  lead: PeakData;
  checkout: PeakData;
  report_timezone?: string;
};

function bestTimesTzNote(tz?: string) {
  if (!tz || tz === 'America/Sao_Paulo') return 'Horários no fuso de Brasília (para planejar suas campanhas daqui).';
  return `Horários no fuso ${tz.replace(/_/g, ' ')}.`;
}

interface BestTimeCardsProps {
  siteId?: number;
  period?: string;
}

const DAYS_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const PERIOD_LABELS: Record<string, string> = {
  'today': 'Hoje',
  'yesterday': 'Ontem',
  'last_7d': '7 dias',
  'last_14d': '14 dias',
  'last_30d': '30 dias',
  'maximum': 'Máximo'
};

function formatSource(rawSource: string) {
  if (!rawSource || rawSource.toLowerCase().includes('direct') || rawSource.toLowerCase().includes('unknown')) return 'Direto / Orgânico';

  try {
    const source = decodeURIComponent(rawSource).trim().toLowerCase();

    // Tratamento direto de UTMs comuns dinâmicos (ig, fb, etc)
    if (source === 'ig' || source === 'instagram') return 'Instagram';
    if (source === 'fb' || source === 'facebook') return 'Facebook';
    if (source === 'tk' || source === 'tiktok') return 'TikTok';
    if (source === 'yt' || source === 'youtube') return 'YouTube';
    if (source === 'google' || source === 'gads') return 'Google';

    // Tratamento por Host/Referrer
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
      // Fast fallback string checks
      const lw = decodedFallback.toLowerCase();
      if (lw === 'ig' || lw === 'instagram') return 'Instagram';
      if (lw === 'fb' || lw === 'facebook') return 'Facebook';
      return decodedFallback;
    } catch {
      return rawSource;
    }
  }
}

const Card = ({ title, data, color, textColor }: { title: string; data: PeakData; color: string; textColor: string }) => {
  const hasData = data.daily_peaks.some(d => d.count > 0);

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/60 p-5 shadow-sm h-full flex flex-col select-none">
      <div className="flex items-center gap-2 mb-4 shrink-0">
        <div className={`w-2 h-2 rounded-full ${color}`} />
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
      </div>

      {hasData ? (
        <div className="flex-1 flex flex-col justify-between">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-100 dark:border-zinc-800/50">
                  <th className="text-left py-2 font-medium text-zinc-500">Dia</th>
                  <th className="text-right py-2 font-medium text-zinc-500">Melhor Horário</th>
                </tr>
              </thead>
              <tbody>
                {data.daily_peaks.map((day) => (
                  <tr
                    key={day.dow}
                    className={twMerge(
                      "border-b border-zinc-50 dark:border-zinc-800/30 last:border-0",
                      day.is_best_day ? "bg-zinc-50/80 dark:bg-zinc-800/40 font-medium" : ""
                    )}
                  >
                    <td className={twMerge(
                      "py-2 pl-2",
                      day.is_best_day ? textColor : "text-zinc-600 dark:text-zinc-400"
                    )}>
                      {DAYS_SHORT[day.dow]}
                      {day.is_best_day && <span className="ml-1.5 text-[9px] uppercase tracking-wide opacity-70 border border-current rounded px-1">Top</span>}
                    </td>
                    <td className="py-2 pr-2 text-right text-zinc-700 dark:text-zinc-300 tabular-nums">
                      {day.hour !== null ? `${day.hour}h - ${day.hour + 1}h` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.top_sources && data.top_sources.length > 0 && (
            <div className="mt-4 pt-4 border-t border-zinc-100 dark:border-zinc-800/50">
              <h4 className="text-[10px] font-semibold tracking-wider uppercase text-zinc-500 mb-2">
                Top Origens
              </h4>
              <div className="space-y-1.5">
                {Object.entries(
                  data.top_sources.reduce((acc, src) => {
                    const name = formatSource(src.source);
                    acc[name] = (acc[name] || 0) + Number(src.count);
                    return acc;
                  }, {} as Record<string, number>)
                )
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 5)
                  .map(([name, count], idx) => (
                    <div key={idx} className="flex items-center justify-between text-xs">
                      <span className="text-zinc-600 dark:text-zinc-400 truncate max-w-[70%]">
                        {name}
                      </span>
                      <span className="text-zinc-900 dark:text-zinc-100 font-medium tabular-nums">
                        {count}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {data.top_locations && data.top_locations.length > 0 && (
            <div className="mt-4 pt-4 border-t border-zinc-100 dark:border-zinc-800/50">
              <h4 className="text-[10px] font-semibold tracking-wider uppercase text-zinc-500 mb-1">
                Top Regiões
              </h4>
              <p className="text-[9px] text-zinc-500 dark:text-zinc-500 leading-snug mb-2">
                País do <strong>pixel</strong> (Meta) é cruzado com o país do <strong>IP</strong>: se baterem,
                mostramos cidade/estado do IP com &quot;· pixel&quot;. Se não baterem, ficamos só no país do
                pixel para evitar cidade errada (VPN, CDN, datacenter). Sem país do pixel, segue só estimativa
                por IP.
              </p>
              <div className="space-y-1.5">
                {data.top_locations.map((loc, idx) => (
                  <div key={idx} className="flex items-center justify-between text-xs">
                    <span className="text-zinc-600 dark:text-zinc-400 truncate max-w-[70%]">
                      {loc.location}
                    </span>
                    <span className="text-zinc-900 dark:text-zinc-100 font-medium tabular-nums">
                      {loc.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center min-h-[200px] text-xs text-zinc-500 italic">
          Sem dados suficientes
        </div>
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

  if (loading) return (
    <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
      {[1, 2, 3].map(i => (
        <div key={i} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/60 p-5 h-[300px] animate-pulse">
          <div className="h-4 w-24 bg-zinc-200 dark:bg-zinc-800 rounded mb-4"></div>
          <div className="space-y-3">
            {[...Array(7)].map((_, j) => (
              <div key={j} className="h-3 w-full bg-zinc-100 dark:bg-zinc-800/50 rounded"></div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  const emptyData: PeakData = { daily_peaks: [], total_volume: 0 };

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
            Picos de Conversão
          </h3>
          <p className="text-[11px] text-zinc-500 mt-0.5 leading-relaxed">
            Melhores horários de cada dia para anunciar (Base: {PERIOD_LABELS[period] || '30 dias'}).{' '}
            {bestTimesTzNote(data?.report_timezone)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-stretch">
        <Card
          title="Leads (Cadastro)"
          data={data?.lead || emptyData}
          color="bg-blue-500"
          textColor="text-blue-600 dark:text-blue-400"
        />
        <Card
          title="Checkout (IC)"
          data={data?.checkout || emptyData}
          color="bg-amber-500"
          textColor="text-amber-600 dark:text-amber-400"
        />
        <Card
          title="Compras (Sales)"
          data={data?.purchase || emptyData}
          color="bg-emerald-500"
          textColor="text-emerald-600 dark:text-emerald-400"
        />
      </div>
    </div>
  );
}
