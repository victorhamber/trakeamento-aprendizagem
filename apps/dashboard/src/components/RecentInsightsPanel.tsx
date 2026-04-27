import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { twMerge } from 'tailwind-merge';

type DailyPeak = { dow: number; hour: number | null; count: number; is_best_day: boolean };
type PeakData = {
  daily_peaks: DailyPeak[];
  top_devices?: { device: string; count: number }[];
  top_locations?: { location: string; count: number }[];
};

type BestTimesRes = { pageview: PeakData; report_timezone?: string };

const DOW_SHORT: Record<number, string> = {
  0: 'Dom',
  1: 'Seg',
  2: 'Ter',
  3: 'Qua',
  4: 'Qui',
  5: 'Sex',
  6: 'Sáb',
};

const DEVICE_LABEL: Record<string, string> = {
  mobile: 'Mobile',
  desktop: 'Desktop',
  tablet: 'Tablet',
  unknown: 'Outros',
};

function bestHourFromPeaks(daily: DailyPeak[]): { dayLabel: string; h0: number; h1: number; dow: number } | null {
  const best = daily.find((d) => d.is_best_day && d.hour != null) || daily.find((d) => d.count > 0 && d.hour != null);
  if (!best || best.hour === null) return null;
  const h = best.hour;
  return { dayLabel: DOW_SHORT[best.dow] || '—', h0: h, h1: h + 1, dow: best.dow };
}

function deviceSummary(devices: { device: string; count: number }[] | undefined): { name: string; pct: number } | null {
  if (!devices?.length) return null;
  const total = devices.reduce((s, d) => s + d.count, 0);
  if (total <= 0) return null;
  const sorted = [...devices].sort((a, b) => b.count - a.count);
  const top = sorted[0]!;
  const pct = Math.round((top.count / total) * 1000) / 10;
  return { name: DEVICE_LABEL[top.device] || top.device, pct };
}

function topRegionSummary(
  locs: { location: string; count: number }[] | undefined
): { line: string } | null {
  if (!locs?.length) return null;
  const total = locs.reduce((s, l) => s + l.count, 0);
  if (total <= 0) return null;
  const top = locs[0]!;
  const pct = Math.round((top.count / total) * 1000) / 10;
  const label = top.location.replace(/\s*·\s*pixel$/i, '').trim();
  return { line: `${label.split(',')[0] || label} concentrou ${String(pct).replace('.', ',')}% do volume` };
}

function InsightRow({
  icon,
  title,
  description,
  iconClass,
  glow,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  iconClass: string;
  glow: string;
}) {
  return (
    <div
      className={twMerge(
        'flex items-center gap-3.5 p-3.5 rounded-xl border border-zinc-200 dark:border-white/10',
        'bg-zinc-50/80 dark:bg-zinc-900/50 hover:border-zinc-300 dark:hover:border-white/15 transition-colors'
      )}
    >
      <div
        className={twMerge('shrink-0 h-10 w-10 rounded-xl border flex items-center justify-center', iconClass, glow)}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 leading-tight">{title}</div>
        <div className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5 leading-relaxed line-clamp-2">{description}</div>
      </div>
      <div className="shrink-0 text-zinc-400 dark:text-zinc-600 text-lg leading-none pr-0.5">›</div>
    </div>
  );
}

export function RecentInsightsPanel({ siteId, period = 'last_7d' }: { siteId?: number; period?: string }) {
  const [data, setData] = useState<BestTimesRes | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ok = true;
    (async () => {
      try {
        setLoading(true);
        const params = new URLSearchParams();
        if (siteId) params.set('siteId', String(siteId));
        params.set('period', period);
        const res = await api.get<BestTimesRes>(`/stats/best-times?${params.toString()}`);
        if (ok) setData(res.data);
      } catch {
        if (ok) setData(null);
      } finally {
        if (ok) setLoading(false);
      }
    })();
    return () => {
      ok = false;
    };
  }, [siteId, period]);

  const { timeLine, deviceLine, regionLine } = useMemo(() => {
    const pv = data?.pageview;
    if (!pv) {
      return {
        timeLine: null as string | null,
        deviceLine: null as string | null,
        regionLine: null as string | null,
      };
    }
    const bh = bestHourFromPeaks(pv.daily_peaks || []);
    const timeLine = bh
      ? `${bh.dayLabel} ${bh.h0}h – ${bh.h1}h com pico de PageView no período.`
      : 'Ainda sem picos claros o suficiente no período selecionado.';

    const d = deviceSummary(pv.top_devices);
    const deviceLine = d
      ? `${d.name} concentrou ${String(d.pct).replace('.', ',')}% do volume (amostra de user-agent).`
      : 'Assim que houver user-agent nos eventos, mostramos o dispositivo de maior peso.';

    const r = topRegionSummary(pv.top_locations);
    const regionLine = r ? r.line : 'Regiões aparecem quando o pixel ou o IP tiverem dados suficientes.';

    return { timeLine, deviceLine, regionLine };
  }, [data]);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-[76px] rounded-xl border border-zinc-200 dark:border-white/10 bg-zinc-100/50 dark:bg-zinc-800/30 animate-pulse"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <InsightRow
        icon={
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
            <circle cx="12" cy="12" r="8" />
            <path d="M12 8v4l2.5 1.5" strokeLinecap="round" />
          </svg>
        }
        title="Melhor horário para campanhas"
        description={timeLine || '—'}
        iconClass="text-cyan-500 dark:text-cyan-300 border-cyan-500/25 bg-cyan-500/10"
        glow="shadow-[0_0_20px_rgba(34,211,238,0.25)]"
      />
      <InsightRow
        icon={
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
            <rect x="6" y="3" width="12" height="18" rx="2" />
            <path d="M10 18h4" strokeLinecap="round" />
          </svg>
        }
        title="Dispositivo com melhor desempenho"
        description={deviceLine || '—'}
        iconClass="text-sky-500 dark:text-sky-300 border-sky-500/25 bg-sky-500/10"
        glow="shadow-[0_0_18px_rgba(14,165,233,0.2)]"
      />
      <InsightRow
        icon={
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
            <path d="M12 22s7-4.5 7-10a7 7 0 0 0-14 0c0 5.5 7 10 7 10z" strokeLinejoin="round" />
            <circle cx="12" cy="10" r="2.5" />
          </svg>
        }
        title="Região em destaque"
        description={regionLine || '—'}
        iconClass="text-violet-500 dark:text-violet-300 border-violet-500/25 bg-violet-500/10"
        glow="shadow-[0_0_18px_rgba(139,92,246,0.2)]"
      />
    </div>
  );
}

export function RecentInsightsBlock({ siteId, period }: { siteId?: number; period?: string }) {
  return (
    <div className="neo-card neo-border neo-glow h-full rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-950/45 p-5 shadow-sm dark:shadow-none select-none flex flex-col">
      <div className="mb-4">
        <div className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Outros insights recentes</div>
        <div className="text-[11px] text-zinc-500 mt-0.5">Base: PageView do período (lado a lado com a receita).</div>
      </div>
      <div className="flex-1 min-h-0">
        <RecentInsightsPanel siteId={siteId} period={period} />
      </div>
    </div>
  );
}
