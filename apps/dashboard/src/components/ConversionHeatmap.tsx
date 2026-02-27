import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { twMerge } from 'tailwind-merge';

interface HeatmapData {
  dow: number;
  hour: number;
  count: number;
}

interface ConversionHeatmapProps {
  siteId?: number;
}

const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

export function ConversionHeatmap({ siteId }: ConversionHeatmapProps) {
  const [data, setData] = useState<HeatmapData[]>([]);
  const [loading, setLoading] = useState(true);
  const [maxCount, setMaxCount] = useState(0);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const params = new URLSearchParams();
        if (siteId) params.append('siteId', String(siteId));
        // Default conversion events
        params.append('events', 'Purchase,Lead,CompleteRegistration,InitiateCheckout');
        params.append('period', 'last_30d');

        const res = await api.get(`/stats/heatmap?${params.toString()}`);
        setData(res.data.matrix);
        
        const max = Math.max(...res.data.matrix.map((d: any) => d.count));
        setMaxCount(max > 0 ? max : 1);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [siteId]);

  const getIntensity = (count: number) => {
    if (count === 0) return 0;
    return Math.ceil((count / maxCount) * 4); // 1-4 scale
  };

  const getColor = (intensity: number) => {
    switch (intensity) {
      case 0: return 'bg-zinc-50 dark:bg-zinc-800/30';
      case 1: return 'bg-blue-100 dark:bg-blue-900/20';
      case 2: return 'bg-blue-300 dark:bg-blue-700/40';
      case 3: return 'bg-blue-500 dark:bg-blue-600';
      case 4: return 'bg-blue-700 dark:bg-blue-500';
      default: return 'bg-zinc-50';
    }
  };

  if (loading) return <div className="p-8 text-center text-zinc-500 text-sm">Carregando mapa de calor...</div>;

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/60 p-5 shadow-sm dark:shadow-none mb-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
            Horários de Conversão
          </h3>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            Concentração de vendas e leads nos últimos 30 dias
          </p>
        </div>
      </div>
      
      <div className="overflow-x-auto pb-2">
        <div className="min-w-[700px]">
          {/* Header das Horas */}
          <div className="flex ml-10 mb-2">
            {HOURS.map(h => (
              <div key={h} className="flex-1 text-center text-[10px] text-zinc-400 font-medium">
                {h}h
              </div>
            ))}
          </div>

          {/* Grid de Dias */}
          <div className="flex flex-col gap-1.5">
            {DAYS.map((dayName, dow) => (
              <div key={dow} className="flex items-center h-8">
                <div className="w-10 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                  {dayName}
                </div>
                <div className="flex-1 flex gap-1 h-full">
                  {HOURS.map(hour => {
                    const cell = data.find(d => d.dow === dow && d.hour === hour);
                    const count = cell?.count || 0;
                    const intensity = getIntensity(count);
                    
                    return (
                      <div
                        key={hour}
                        className={twMerge(
                          "flex-1 rounded-sm transition-all duration-200 relative group border border-transparent hover:border-zinc-400 dark:hover:border-zinc-500 hover:scale-110 hover:z-10 cursor-default",
                          getColor(intensity)
                        )}
                      >
                        {/* Tooltip on hover */}
                        <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 bg-zinc-900 text-white text-xs rounded shadow-lg whitespace-nowrap z-20 pointer-events-none">
                          <div className="font-semibold">{dayName}, {hour}:00 - {hour}:59</div>
                          <div>{count} conversões</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          
          <div className="mt-6 flex items-center justify-end gap-3 text-[10px] text-zinc-500 uppercase tracking-wider font-medium">
            <span>Menos</span>
            <div className="flex gap-1">
                <div className="w-3 h-3 rounded-sm bg-zinc-50 dark:bg-zinc-800/30 border border-zinc-200 dark:border-zinc-700"></div>
                <div className="w-3 h-3 rounded-sm bg-blue-100 dark:bg-blue-900/20"></div>
                <div className="w-3 h-3 rounded-sm bg-blue-300 dark:bg-blue-700/40"></div>
                <div className="w-3 h-3 rounded-sm bg-blue-500 dark:bg-blue-600"></div>
                <div className="w-3 h-3 rounded-sm bg-blue-700 dark:bg-blue-500"></div>
            </div>
            <span>Mais</span>
          </div>
        </div>
      </div>
    </div>
  );
}
