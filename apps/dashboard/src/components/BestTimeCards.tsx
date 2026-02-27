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
};

type BestTimesData = {
  purchase: PeakData;
  lead: PeakData;
  checkout: PeakData;
};

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

const Card = ({ title, data, color, textColor }: { title: string; data: PeakData; color: string; textColor: string }) => {
  const hasData = data.daily_peaks.some(d => d.count > 0);

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/60 p-5 shadow-sm h-full flex flex-col">
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
          <p className="text-[11px] text-zinc-500 mt-0.5">
            Melhores horários de cada dia para anunciar (Base: {PERIOD_LABELS[period] || '30 dias'})
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
