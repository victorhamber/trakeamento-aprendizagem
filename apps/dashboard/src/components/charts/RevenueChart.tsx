import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

type DailyPoint = {
  date: string;
  count: number;
  revenue: number;
};

export function RevenueChart({ data, currency, isDark }: { data: DailyPoint[]; currency: string; isDark: boolean }) {
  const fmtCurrency = (v: number) => new Intl.NumberFormat(
    currency === 'BRL' ? 'pt-BR' : 'en-US',
    { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }
  ).format(v);

  const fmtDate = (dateStr: string) => {
    // dateStr is YYYY-MM-DD
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  };

  const lineColor = isDark ? '#34d399' : '#059669';
  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const textColor = isDark ? '#71717a' : '#6b7280';

  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[300px] text-xs text-zinc-400 dark:text-zinc-600">
        Sem dados no período selecionado
      </div>
    );
  }

  // Se tiver apenas 1 ponto, adiciona um ponto anterior artificial (0,0) para desenhar a linha
  // Útil para "Hoje" quando só teve 1 venda
  const chartData = [...data];
  if (chartData.length === 1) {
    const originalDate = chartData[0].date;
    // Tenta criar um ponto anterior no mesmo dia (00:00 visualmente, mas aqui usamos data string)
    // Como o eixo X é data, não hora, duplicar a data pode ficar estranho, mas é melhor que nada.
    // Melhor abordagem: se o gráfico for por DIA, e só tem 1 dia, Recharts renderiza ponto.
    // Vamos adicionar o dia anterior zerado.
    const d = new Date(originalDate);
    d.setDate(d.getDate() - 1);
    const prevDate = d.toISOString().split('T')[0];
    chartData.unshift({ date: prevDate, count: 0, revenue: 0 });
  }

  return (
    <div className="h-[300px] w-full select-none outline-none focus:outline-none">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
          <XAxis 
            dataKey="date" 
            tickFormatter={fmtDate} 
            stroke={textColor} 
            tick={{ fontSize: 11 }} 
            tickLine={false}
            axisLine={false}
            dy={10}
          />
          <YAxis 
            tickFormatter={(val) => fmtCurrency(val)} 
            stroke={textColor} 
            tick={{ fontSize: 11 }} 
            tickLine={false}
            axisLine={false}
            width={60}
          />
          <Tooltip 
            formatter={(value: any) => [fmtCurrency(Number(value)), 'Receita']}
            labelFormatter={(label: any) => fmtDate(String(label))}
            contentStyle={{ 
              backgroundColor: isDark ? '#18181b' : '#fff', 
              borderColor: isDark ? '#27272a' : '#e4e4e7',
              borderRadius: '8px',
              fontSize: '12px'
            }}
            itemStyle={{ color: isDark ? '#e4e4e7' : '#18181b' }}
          />
          <Line 
            type="monotone" 
            dataKey="revenue" 
            stroke={lineColor} 
            strokeWidth={2} 
            dot={{ r: 4, fill: lineColor, strokeWidth: 2, stroke: isDark ? '#18181b' : '#fff' }} 
            activeDot={{ r: 6, fill: lineColor, stroke: isDark ? '#fff' : '#000', strokeWidth: 2, outline: 'none' }} 
            isAnimationActive={true}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
