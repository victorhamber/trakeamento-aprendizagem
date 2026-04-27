type FunnelPayload = {
  page_views?: number;
  leads?: number;
  checkouts?: number;
  purchases?: number;
};

const SEG_STOPS: { a: string; b: string; c: string }[] = [
  { a: '#22d3ee', b: '#14b8a6', c: '#0d9488' },
  { a: '#0ea5e9', b: '#2563eb', c: '#1d4ed8' },
  { a: '#6366f1', b: '#7c3aed', c: '#5b21b6' },
  { a: '#8b5cf6', b: '#6d28d9', c: '#3b0764' },
];

function fmtCount(n: number) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return '0';
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (v >= 10_000) return v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  if (v >= 1_000) return `${(v / 1_000).toFixed(1).replace(/\.0$/, '')}K`.replace('.', ',');
  return String(Math.trunc(v));
}

function fmtPctOfTop(part: number, top: number) {
  if (top <= 0) return '0,0%';
  const p = (part / top) * 100;
  return `${p.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function FunnelIcon({ kind, x, y }: { kind: 'page' | 'users' | 'cart' | 'bag'; x: number; y: number }) {
  const c = { stroke: 'rgba(255,255,255,0.95)', fill: 'none' as const, strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (kind === 'page') {
    return (
      <g transform={`translate(${x - 12} ${y - 10})`}>
        <rect x="2" y="4" width="20" height="14" rx="2" {...c} />
        <path d="M7 4V2.5A1.5 1.5 0 0 1 8.5 1h7A1.5 1.5 0 0 1 17 2.5V4" {...c} />
        <path d="M9 11h6" stroke="rgba(255,255,255,0.9)" fill="none" strokeWidth="1.4" strokeLinecap="round" />
        <line x1="8" y1="22" x2="16" y2="22" stroke="rgba(255,255,255,0.6)" strokeWidth="1.5" strokeLinecap="round" />
      </g>
    );
  }
  if (kind === 'users') {
    return (
      <g transform={`translate(${x - 15} ${y - 10})`}>
        <circle cx="8" cy="5" r="3" stroke="rgba(255,255,255,0.95)" fill="none" strokeWidth="1.8" />
        <path d="M3 19.5v-.5A5.5 5.5 0 0 1 8.5 13" {...c} />
        <path d="M8.5 13A5.5 5.5 0 0 1 14 19v.5" {...c} />
        <circle cx="17" cy="5.5" r="2.5" stroke="rgba(255,255,255,0.85)" fill="none" strokeWidth="1.4" />
        <path d="M21 14v.5" stroke="rgba(255,255,255,0.85)" strokeWidth="1.4" strokeLinecap="round" />
      </g>
    );
  }
  if (kind === 'cart') {
    return (
      <g transform={`translate(${x - 12} ${y - 10})`}>
        <path d="M1 1h2.5l1.1 6.2A2 2 0 0 0 6.3 9H19l2-5H4.2" stroke="rgba(255,255,255,0.95)" fill="none" strokeWidth="1.8" strokeLinejoin="round" />
        <circle cx="7.5" cy="20" r="1.5" fill="rgba(255,255,255,0.15)" stroke="rgba(255,255,255,0.9)" strokeWidth="1" />
        <circle cx="17" cy="20" r="1.5" fill="rgba(255,255,255,0.15)" stroke="rgba(255,255,255,0.9)" strokeWidth="1" />
      </g>
    );
  }
  return (
    <g transform={`translate(${x - 10} ${y - 10})`}>
      <path d="M4 3h16a1 1 0 0 1 1 1v14l-1 1H4l-1-1V4a1 1 0 0 1 1-1z" {...c} />
      <path d="M8 3V1.5A1.5 1.5 0 0 1 9.5 0h5A1.5 1.5 0 0 1 16 1.5V3" {...c} />
    </g>
  );
}

export function FunnelChart({ data, isDark }: { data: FunnelPayload | null; isDark: boolean }) {
  if (!data) return null;

  const page = Number(data.page_views || 0);
  const lead = Number(data.leads || 0);
  const ic = Number(data.checkouts || 0);
  const pur = Number(data.purchases || 0);
  const top = page;

  const stages = [
    { key: 'page', label: 'PageView', value: page, icon: 'page' as const },
    { key: 'lead', label: 'Lead', value: lead, icon: 'users' as const },
    { key: 'ic', label: 'InitiateCheckout', value: ic, icon: 'cart' as const },
    { key: 'pur', label: 'Compras', value: pur, icon: 'bag' as const },
  ];

  const W = 920;
  const H = 600;
  const leftX = 64;
  const rightX = W - 64;
  const topY = 48;
  const stageH = 86;
  const gap = 11;
  const skew = 20;
  const widths = [1.0, 0.8, 0.62, 0.45];

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

  const cardBg = isDark ? 'url(#funnelCardBg)' : '#f8fafc';
  const labelFill = isDark ? 'rgba(255,255,255,0.8)' : 'rgba(15,23,42,0.6)';
  const valueFill = isDark ? '#ffffff' : '#0f172a';
  const pctFill = isDark ? '#ffffff' : '#0f172a';
  const strokePoly = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(15, 23, 42, 0.08)';

  const taxaGeral = page > 0 ? (pur / page) * 100 : 0;
  const taxaStr = taxaGeral.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="h-[440px] sm:h-[480px] w-full min-h-[400px] select-none outline-none focus:outline-none">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" role="img" aria-label="Funil PageView, Lead, InitiateCheckout, Compras">
        <defs>
          <radialGradient id="funnelCardBg" cx="50%" cy="35%" r="70%">
            <stop offset="0%" stopColor="#0d1a14" stopOpacity="1" />
            <stop offset="100%" stopColor="#050a08" stopOpacity="1" />
          </radialGradient>
          {SEG_STOPS.map((st, i) => (
            <linearGradient key={`seg${i}`} id={`funnelSeg${i}`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={st.a} stopOpacity={isDark ? 0.95 : 0.55} />
              <stop offset="50%" stopColor={st.b} stopOpacity={isDark ? 0.88 : 0.5} />
              <stop offset="100%" stopColor={st.c} stopOpacity={isDark ? 0.78 : 0.45} />
            </linearGradient>
          ))}
          {SEG_STOPS.map((st, i) => (
            <linearGradient key={`streak${i}`} id={`funnelStreak${i}`} x1="0%" y1="0%" x2="18%" y2="0%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity={isDark ? 0.22 : 0.1} />
              <stop offset="100%" stopColor={st.a} stopOpacity="0" />
            </linearGradient>
          ))}
          <filter id="funnelSegGlow" x="-25%" y="-25%" width="150%" height="150%">
            <feGaussianBlur stdDeviation="2.8" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <rect x="0" y="0" width={W} height={H} fill={isDark ? cardBg : '#f8fafc'} rx="12" />

        {stages.map((s, i) => {
          const g = layer(i);
          const pts = `${g.x0l},${g.y0} ${g.x0r},${g.y0} ${g.x1r},${g.y1} ${g.x1l},${g.y1}`;
          const streakPts = `${g.x0l + 2},${g.y0} ${g.x0l + (g.x0r - g.x0l) * 0.2},${g.y0} ${g.x0l + (g.x1r - g.x1l) * 0.2 + 2},${g.y1} ${g.x0l + 2},${g.y1}`;

          const share =
            top <= 0 ? '0,0%' : i === 0 ? '100,0%' : fmtPctOfTop(s.value, top);

          return (
            <g key={s.key}>
              <polygon
                points={pts}
                fill={`url(#funnelSeg${i})`}
                stroke={strokePoly}
                strokeWidth="1.2"
                filter="url(#funnelSegGlow)"
                opacity={isDark ? 0.98 : 0.92}
              />
              <polygon
                points={streakPts}
                fill={`url(#funnelStreak${i})`}
                opacity={isDark ? 0.85 : 0.35}
              />
              <polyline
                points={`${g.x0l + 1},${g.y0} ${g.x1l + 1},${g.y1}`}
                stroke="rgba(255,255,255,0.35)"
                strokeWidth="2.5"
                strokeLinecap="round"
                opacity={isDark ? 0.4 : 0.2}
              />

              <FunnelIcon kind={s.icon} x={g.x0l + 40} y={g.midY} />

              <text
                x={g.cx + 8}
                y={g.midY - 12}
                textAnchor="middle"
                fill={labelFill}
                fontSize="19"
                fontWeight="600"
                fontFamily="ui-sans-serif, system-ui, Inter, sans-serif"
              >
                {s.label}
              </text>
              <text
                x={g.cx + 8}
                y={g.midY + 22}
                textAnchor="middle"
                fill={valueFill}
                fontSize="36"
                fontWeight="800"
                fontFamily="ui-sans-serif, system-ui, Inter, sans-serif"
              >
                {fmtCount(s.value)}
              </text>
              <text
                x={g.x0r - 22}
                y={g.midY + 6}
                textAnchor="end"
                fill={pctFill}
                fontSize="24"
                fontWeight="800"
                fontFamily="ui-sans-serif, system-ui, Inter, sans-serif"
              >
                {share}
              </text>
            </g>
          );
        })}

        {/* Pílula: taxa geral */}
        <g transform={`translate(${W / 2} ${H - 52})`}>
          <rect
            x="-200"
            y="-18"
            width="400"
            height="40"
            rx="20"
            fill={isDark ? 'rgba(9, 15, 12, 0.9)' : 'rgba(255,255,255,0.9)'}
            stroke={isDark ? 'rgba(124, 58, 237, 0.45)' : 'rgba(124, 58, 237, 0.3)'}
            strokeWidth="1.2"
          />
          <text
            x="0"
            y="6"
            textAnchor="middle"
            fill={isDark ? 'rgba(255,255,255,0.7)' : 'rgba(15,23,42,0.65)'}
            fontSize="16"
            fontWeight="500"
            fontFamily="ui-sans-serif, system-ui, Inter, sans-serif"
          >
            Taxa de conversão geral:{' '}
            <tspan fill={isDark ? '#c4b5fd' : '#5b21b6'} fontWeight="800">
              {taxaStr}%
            </tspan>
          </text>
        </g>
      </svg>
    </div>
  );
}
