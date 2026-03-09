import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList } from 'recharts';

export function FunnelChart({ data, isDark }: { data: any; isDark: boolean }) {
  if (!data) return null;

  const chartData = [
    { name: 'Visitas', value: data.page_views || 0, fill: '#60a5fa' }, // Blue
    { name: 'Engajamento', value: data.engagements || 0, fill: '#34d399' }, // Emerald
    { name: 'Checkout', value: data.checkouts || 0, fill: '#fbbf24' }, // Amber
    { name: 'Compras', value: data.purchases || 0, fill: '#f87171' }, // Red
  ];

  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const textColor = isDark ? '#71717a' : '#6b7280';

  return (
    <div className="h-[300px] w-full select-none outline-none focus:outline-none">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart 
          data={chartData} 
          layout="vertical" 
          margin={{ top: 10, right: 50, left: 40, bottom: 0 }}
          barCategoryGap={20}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} horizontal={false} />
          <XAxis type="number" hide />
          <YAxis 
            dataKey="name" 
            type="category" 
            width={80} 
            stroke={textColor}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip 
            cursor={{ fill: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)' }}
            formatter={(value: any) => [value, 'Usuários']}
            contentStyle={{ 
              backgroundColor: isDark ? '#18181b' : '#fff', 
              borderColor: isDark ? '#27272a' : '#e4e4e7',
              borderRadius: '8px',
              fontSize: '12px',
              color: isDark ? '#fff' : '#000'
            }}
            itemStyle={{ color: isDark ? '#e4e4e7' : '#18181b' }}
          />
          <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={32} isAnimationActive={true}>
             {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.fill} style={{ outline: 'none' }} />
            ))}
            <LabelList 
              dataKey="value" 
              position="right" 
              fill={isDark ? '#e4e4e7' : '#3f3f46'} 
              style={{ fontSize: '12px', fontWeight: 'bold' }} 
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
