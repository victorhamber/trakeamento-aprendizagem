import { useEffect, useState } from 'react';
import { api } from '../lib/api';

type PeakData = {
  best_day: number | null;
  best_hour: number | null;
  total: number;
};

type BestTimesData = {
  purchase: PeakData;
  lead: PeakData;
  checkout: PeakData;
};

interface BestTimeCardsProps {
  siteId?: number;
}

const DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

const Card = ({ title, data, color }: { title: string; data: PeakData; color: string }) => {
  const hasData = data.best_day !== null && data.best_hour !== null;

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/60 p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <div className={`w-2 h-2 rounded-full ${color}`} />
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
      </div>
      
      {hasData ? (
        <div className="space-y-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium mb-1">Melhor Dia</div>
            <div className="text-lg font-bold text-zinc-800 dark:text-zinc-200">
              {DAYS[data.best_day!]}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium mb-1">Melhor Horário</div>
            <div className="text-lg font-bold text-zinc-800 dark:text-zinc-200">
              {data.best_hour}h - {data.best_hour! + 1}h
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-center h-24 text-xs text-zinc-500 italic">
          Sem dados suficientes
        </div>
      )}
    </div>
  );
};

export function BestTimeCards({ siteId }: BestTimeCardsProps) {
  const [data, setData] = useState<BestTimesData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const params = new URLSearchParams();
        if (siteId) params.append('siteId', String(siteId));
        params.append('period', 'last_30d');

        const res = await api.get(`/stats/best-times?${params.toString()}`);
        setData(res.data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [siteId]);

  if (loading) return null; // Skeleton could be better but null is fine for now

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
            Picos de Conversão
          </h3>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            Melhores momentos para anunciar (Base: 30 dias)
          </p>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card 
          title="Compras (Sales)" 
          data={data?.purchase || { best_day: null, best_hour: null, total: 0 }} 
          color="bg-emerald-500" 
        />
        <Card 
          title="Leads (Cadastro)" 
          data={data?.lead || { best_day: null, best_hour: null, total: 0 }} 
          color="bg-blue-500" 
        />
        <Card 
          title="Checkout (IC)" 
          data={data?.checkout || { best_day: null, best_hour: null, total: 0 }} 
          color="bg-amber-500" 
        />
      </div>
    </div>
  );
}
