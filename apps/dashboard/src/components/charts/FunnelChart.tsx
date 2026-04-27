export function FunnelChart({ data, isDark }: { data: any; isDark: boolean }) {
  if (!data) return null;

  const fmt = (n: number) => {
    const v = Number(n || 0);
    if (!Number.isFinite(v)) return '0';
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`.replace('.0M', 'M');
    if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`.replace('.0K', 'K');
    return String(Math.trunc(v));
  };

  // Não existe "Link Click" direto no tracking atual do dashboard.
  // Aqui usamos PageEngagement como proxy para "Clique no link".
  const linkClicksProxy = Number(data.engagements || 0);
  const visits = Number(data.page_views || 0);
  const checkouts = Number(data.checkouts || 0);
  const purchases = Number(data.purchases || 0);

  // Garante consistência visual do funil (evita % > 100% quando o proxy vem menor que visitas)
  const top = Math.max(linkClicksProxy, visits);

  const stages = [
    { key: 'clicks', label: 'Clique no link', value: linkClicksProxy || top },
    { key: 'visits', label: 'Visitas', value: visits },
    { key: 'checkouts', label: 'Checkout', value: checkouts },
    { key: 'purchases', label: 'Compras', value: purchases },
  ];

  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
  const pctPrev = [100, pct(visits, top), pct(checkouts, visits), pct(purchases, checkouts)];

  // Geometry in viewBox coordinates
  const W = 920;
  const H = 520;
  const leftX = 80;
  const rightX = W - 80;
  const topY = 70;
  const stageH = 92;
  const gap = 12;
  const skew = 22; // makes the right edge "lean"

  const widths = [
    1.0,
    0.78,
    0.62,
    0.48,
  ];

  const layer = (i: number) => {
    const y0 = topY + i * (stageH + gap);
    const y1 = y0 + stageH;
    const w0 = (rightX - leftX) * widths[i];
    const nextWidth = widths[i + 1];
    const w1 = nextWidth !== undefined ? (rightX - leftX) * nextWidth : w0 * 0.78;
    const cx = W / 2;
    const x0l = cx - w0 / 2;
    const x0r = cx + w0 / 2 + skew;
    const x1l = cx - w1 / 2;
    const x1r = cx + w1 / 2 + skew;
    return { y0, y1, x0l, x0r, x1l, x1r };
  };

  const bg = isDark ? '#0b0f14' : '#ffffff';
  const stroke = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(24,24,27,0.10)';
  const text1 = isDark ? '#e5e7eb' : '#0f172a';
  const text2 = isDark ? 'rgba(229,231,235,0.75)' : 'rgba(15,23,42,0.65)';

  return (
    <div className="h-[420px] sm:h-[460px] w-full select-none outline-none focus:outline-none">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
        <defs>
          <linearGradient id="funnelFill" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#22c55e" stopOpacity="0.55" />
            <stop offset="45%" stopColor="#10b981" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.55" />
          </linearGradient>
          <linearGradient id="funnelEdge" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#22c55e" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#22c55e" stopOpacity="0.0" />
          </linearGradient>
          <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feColorMatrix
              in="blur"
              type="matrix"
              values="
                0 0 0 0 0.13
                0 0 0 0 0.90
                0 0 0 0 0.67
                0 0 0 0.18 0"
              result="glowColor"
            />
            <feMerge>
              <feMergeNode in="glowColor" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <rect x="0" y="0" width={W} height={H} fill={bg} opacity={0} />

        {/* Subtle neon line behind */}
        <path
          d={`M ${leftX} ${topY - 28} L ${rightX} ${topY - 48}`}
          stroke="rgba(16,185,129,0.08)"
          strokeWidth="3"
          strokeLinecap="round"
          filter="url(#glow)"
        />

        {stages.map((s, i) => {
          const g = layer(i);
          const pts = `${g.x0l},${g.y0} ${g.x0r},${g.y0} ${g.x1r},${g.y1} ${g.x1l},${g.y1}`;
          const cx = (g.x0l + g.x0r + g.x1l + g.x1r) / 4;
          const cy = (g.y0 + g.y1) / 2 + 3;
          const stagePct = pctPrev[i] ?? 0;
          return (
            <g key={s.key}>
              <polygon points={pts} fill="url(#funnelFill)" stroke={stroke} strokeWidth="1.0" filter="url(#glow)" opacity={0.94} />
              {/* Left edge highlight */}
              <polyline
                points={`${g.x0l},${g.y0} ${g.x1l},${g.y1}`}
                stroke="url(#funnelEdge)"
                strokeWidth="3"
                strokeLinecap="round"
                opacity={0.5}
              />

              <text x={cx} y={cy - 10} textAnchor="middle" fill={text2} fontSize="22" fontWeight="700">
                {s.label}
              </text>
              <text x={cx} y={cy + 22} textAnchor="middle" fill={text1} fontSize="34" fontWeight="800">
                {fmt(s.value)}
              </text>
              <text x={g.x0r - 26} y={cy + 6} textAnchor="end" fill={text1} fontSize="22" fontWeight="800">
                {i === 0 ? '100%' : `${stagePct}%`}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
