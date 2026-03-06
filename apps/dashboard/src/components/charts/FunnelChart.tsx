import { FunnelChart as RechartsFunnelChart, Funnel, Tooltip, ResponsiveContainer, LabelList, Cell } from 'recharts';

export function FunnelChart({ data, isDark }: { data: any; isDark: boolean }) {
  if (!data) return null;

  const chartData = [
    { name: 'Visitas', value: data.page_views || 0, fill: '#60a5fa' }, // Blue-400
    { name: 'Engajamento', value: data.engagements || 0, fill: '#34d399' }, // Emerald-400
    { name: 'Checkout', value: data.checkouts || 0, fill: '#fbbf24' }, // Amber-400
    { name: 'Compras', value: data.purchases || 0, fill: '#f87171' }, // Red-400
  ];

  // Cores personalizadas para o Funil (Gradiente Visual)
  const colors = [
    '#60a5fa', // Blue
    '#34d399', // Emerald
    '#fbbf24', // Amber
    '#f87171'  // Red
  ];

  return (
    <div className="h-[300px] w-full flex items-center justify-center">
      <ResponsiveContainer width="100%" height="100%">
        <RechartsFunnelChart>
          <Tooltip 
            formatter={(value: number) => [value, 'Usuários']}
            contentStyle={{ 
              backgroundColor: isDark ? '#18181b' : '#fff', 
              borderColor: isDark ? '#27272a' : '#e4e4e7',
              borderRadius: '8px',
              fontSize: '12px',
              color: isDark ? '#fff' : '#000'
            }}
            itemStyle={{ color: isDark ? '#e4e4e7' : '#18181b' }}
          />
          <Funnel
            dataKey="value"
            data={chartData}
            isAnimationActive
            labelLine={false}
          >
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
            ))}
            <LabelList 
              position="right" 
              fill={isDark ? '#e4e4e7' : '#3f3f46'} 
              stroke="none" 
              dataKey="name" 
              style={{ fontSize: '12px', fontWeight: 'bold' }}
            />
            <LabelList 
              position="center" 
              fill="#fff" 
              stroke="none" 
              dataKey="value" 
              style={{ fontSize: '14px', fontWeight: 'bold', textShadow: '0px 1px 2px rgba(0,0,0,0.5)' }}
            />
          </Funnel>
        </RechartsFunnelChart>
      </ResponsiveContainer>
    </div>
  );
}
