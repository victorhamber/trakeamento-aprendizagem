type FunnelPayload = {
  page_views?: number;
  /** Proxy “clique no link” = eventos PageEngagement (API /dashboard/funnel) */
  engagements?: number;
  checkouts?: number;
  purchases?: number;
};

/**
 * Cores do “dashboard neon” (2º print): ciano → azul → roxo → violeta escuro.
 * Forma: funil simples (1º print): trapézios empilhados, gaps, sem ícones.
 */
const SEG_GRADIENTS: { a: string; b: string; c: string }[] = [
  { a: '#22d3ee', b: '#0ea5e9', c: '#0284c7' },
  { a: '#3b82f6', b: '#2563eb', c: '#1d4ed8' },
  { a: '#8b5cf6', b: '#7c3aed', c: '#6d28d9' },
  { a: '#5b21b6', b: '#4c1d95', c: '#3b0764' },
];

function fmtCount(n: number) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return '0';
  if (v >= 1_000_000) {
    const x = v / 1_000_000;
    return `${x.toFixed(1).replace('.', ',').replace(/,?0$/, '')}M`;
  }
  if (v >= 10_000) return v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  if (v >= 1_000) {
    const k = v / 1_000;
    return `${k.toFixed(1).replace('.', ',')}K`;
  }
  return String(Math.trunc(v));
}

function fmtPctChain(num: number, den: number) {
  if (den <= 0) return '0,0%';
  const p = (num / den) * 100;
  return `${p.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

export function FunnelChart({ data, isDark }: { data: FunnelPayload | null; isDark: boolean }) {
  if (!data) return null;

  const clicks = Number(data.engagements || 0);
  const page = Number(data.page_views || 0);
  const ic = Number(data.checkouts || 0);
  const pur = Number(data.purchases || 0);

  const topRef = Math.max(clicks, page);
  const v0 = clicks > 0 ? clicks : topRef;

  const stages = [
    { key: 'clicks', label: 'Cliques no link', value: v0 },
    { key: 'page', label: 'PageView', value: page },
    { key: 'ic', label: 'InitiateCheckout', value: ic },
    { key: 'pur', label: 'Compras', value: pur },
  ];

  // --- Geometria do funil original (viewBox) ---
  const W = 920;
  const H = 520;
  const leftX = 80;
  const rightX = W - 80;
  const topY = 70;
  const stageH = 92;
  const gap = 12;
  const skew = 22;
  const widths = [1, 0.78, 0.62, 0.48];

  const layer = (i: number) => {
    const y0 = topY + i * (stageH + gap);
    const y1 = y0 + stageH;
    const w0 = (rightX - leftX) * widths[i];
    const w1 = (rightX - leftX) * (widths[i + 1] ?? widths[i] * 0.78);
    const cx = W / 2;
    const x0l = cx - w0 / 2;
    const x0r = cx + w0 / 2 + skew;
    const x1l = cx - w1 / 2;
    const x1r = cx + w1 / 2 + skew;
    return { y0, y1, x0l, x0r, x1l, x1r, cx, midY: (y0 + y1) / 2 };
  };

  const stroke = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(15, 23, 42, 0.1)';
  const text1 = isDark ? '#e5e7eb' : '#0f172a';
  const text2 = isDark ? 'rgba(229, 231, 235, 0.78)' : 'rgba(15, 23, 42, 0.6)';

  const longLabel = (s: string) => s.length > 14;

  const shareForIndex = (i: number) => {
    if (i === 0) return topRef > 0 ? '100,0%' : '0,0%';
    if (i === 1) return fmtPctChain(page, topRef);
    if (i === 2) return fmtPctChain(ic, page);
    return fmtPctChain(pur, ic);
  };

  return (
    <div className="h-[400px] sm:h-[430px] w-full select-none outline-none focus:outline-none">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" role="img" preserveAspectRatio="xMidYMid meet">
        <defs>
          {SEG_GRADIENTS.map((st, i) => (
            <linearGradient key={i} id={`funnelSeg${i}`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={st.a} stopOpacity={isDark ? 0.95 : 0.85} />
              <stop offset="50%" stopColor={st.b} stopOpacity={isDark ? 0.9 : 0.8} />
              <stop offset="100%" stopColor={st.c} stopOpacity={isDark ? 0.88 : 0.75} />
            </linearGradient>
          ))}
          <linearGradient id="funnelEdge" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
          </linearGradient>
        </defs>

        {stages.map((s, i) => {
          const g = layer(i);
          const pts = `${g.x0l},${g.y0} ${g.x0r},${g.y0} ${g.x1r},${g.y1} ${g.x1l},${g.y1}`;
          const cx = (g.x0l + g.x0r + g.x1l + g.x1r) / 4;
          const cy = (g.y0 + g.y1) / 2 + 3;
          return (
            <g key={s.key}>
              <polygon points={pts} fill={`url(#funnelSeg${i})`} stroke={stroke} strokeWidth="1" />
              <polyline
                points={`${g.x0l},${g.y0} ${g.x1l},${g.y1}`}
                stroke="url(#funnelEdge)"
                strokeWidth="2"
                strokeLinecap="round"
                opacity={isDark ? 0.28 : 0.2}
              />
              <text
                x={cx}
                y={cy - 10}
                textAnchor="middle"
                fill={text2}
                fontSize={longLabel(s.label) ? 20 : 22}
                fontWeight="600"
                fontFamily="system-ui, 'Segoe UI', Inter, sans-serif"
              >
                {s.label}
              </text>
              <text
                x={cx}
                y={cy + 22}
                textAnchor="middle"
                fill={text1}
                fontSize="34"
                fontWeight="800"
                fontFamily="system-ui, 'Segoe UI', Inter, sans-serif"
              >
                {fmtCount(s.value)}
              </text>
              <text
                x={g.x0r - 26}
                y={cy + 6}
                textAnchor="end"
                fill={text1}
                fontSize="22"
                fontWeight="800"
                fontFamily="system-ui, 'Segoe UI', Inter, sans-serif"
              >
                {shareForIndex(i)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
