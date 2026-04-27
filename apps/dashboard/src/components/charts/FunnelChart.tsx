type FunnelPayload = {
  page_views?: number;
  leads?: number;
  checkouts?: number;
  purchases?: number;
};

/** Cores próximas ao print (teal → azul → roxo) */
const SEG_STOPS: { a: string; b: string; c: string }[] = [
  { a: '#26c6da', b: '#00acc1', c: '#00838f' },
  { a: '#2196f3', b: '#1e88e5', c: '#1565c0' },
  { a: '#7e57c2', b: '#673ab7', c: '#5e35b1' },
  { a: '#6a1b9a', b: '#4a148c', c: '#38006b' },
];

const ICON_RAIL = 56;

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

function fmtPctOfTop(part: number, top: number) {
  if (top <= 0) return '0,0%';
  const p = (part / top) * 100;
  return `${p.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

/** Centro do “miolo” colorido, descontando a faixa de ícone à esquerda */
function contentTextCenter(
  g: { x0l: number; x0r: number; x1l: number; x1r: number; y0: number; y1: number },
  rail: number
) {
  const l0 = g.x0l + rail;
  const l1 = g.x1l + rail;
  const topM = (l0 + g.x0r) / 2;
  const botM = (l1 + g.x1r) / 2;
  return (topM + botM) / 2;
}

function FunnelIcon({ kind, x, y }: { kind: 'page' | 'users' | 'cart' | 'bag'; x: number; y: number }) {
  const s = { stroke: 'rgba(255,255,255,0.95)', fill: 'none' as const, strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (kind === 'page') {
    return (
      <g transform={`translate(${x - 10} ${y - 8})`}>
        <rect x="1" y="3" width="18" height="12" rx="1.5" {...s} />
        <path d="M5 3V2A1.5 1.5 0 0 1 6.5.5H13A1.5 1.5 0 0 1 14.5 2V3" {...s} />
        <path d="M7 9h6" stroke="rgba(255,255,255,0.9)" fill="none" strokeWidth="1.3" strokeLinecap="round" />
      </g>
    );
  }
  if (kind === 'users') {
    return (
      <g transform={`translate(${x - 12} ${y - 8})`}>
        <circle cx="7" cy="4" r="2.8" {...s} />
        <path d="M2.5 15.5v-1A4.5 4.5 0 0 1 7 10" {...s} />
        <path d="M7 10a4.5 4.5 0 0 1 4.5 4.5v1" {...s} />
        <circle cx="15" cy="4.5" r="2.2" stroke="rgba(255,255,255,0.88)" fill="none" strokeWidth="1.3" />
        <path d="M15 6.5v.5" stroke="rgba(255,255,255,0.88)" strokeWidth="1.2" />
      </g>
    );
  }
  if (kind === 'cart') {
    return (
      <g transform={`translate(${x - 11} ${y - 7})`}>
        <path d="M.5.5H3l1 5.2A1.4 1.4 0 0 0 5.3 7H16l1.2-3H4" stroke="rgba(255,255,255,0.95)" fill="none" strokeWidth="1.6" strokeLinejoin="round" />
        <circle cx="6" cy="15.5" r="1.2" fill="rgba(255,255,255,0.2)" stroke="white" strokeWidth="0.8" />
        <circle cx="14" cy="15.5" r="1.2" fill="rgba(255,255,255,0.2)" stroke="white" strokeWidth="0.8" />
      </g>
    );
  }
  return (
    <g transform={`translate(${x - 8} ${y - 7})`}>
      <path d="M2.5 2.5H15.5A1.5 1.5 0 0 1 17 4V14l-1 1.5H3L2 15V4A1.5 1.5 0 0 1 2.5 2.5z" {...s} />
      <path d="M6.5 2.5V1.3A.8.8 0 0 1 7.2.5H11a.8.8 0 0 1 .8.8V2.5" {...s} />
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

  const W = 900;
  const H = 560;
  const leftX = 56;
  const rightX = W - 56;
  const topY = 24;
  const stageH = 80;
  const gap = 4;
  const skew = 16;
  const widths = [1, 0.84, 0.68, 0.5];

  const layer = (i: number) => {
    const y0 = topY + i * (stageH + gap);
    const y1 = y0 + stageH;
    const w0 = (rightX - leftX) * widths[i];
    const w1 = (rightX - leftX) * (widths[i + 1] ?? widths[3] * 0.82);
    const cx = W / 2;
    const x0l = cx - w0 / 2;
    const x0r = cx + w0 / 2 + skew;
    const x1l = cx - w1 / 2;
    const x1r = cx + w1 / 2 + skew;
    return { y0, y1, x0l, x0r, x1l, x1r, cx, midY: (y0 + y1) / 2 };
  };

  const labelFill = isDark ? 'rgba(255,255,255,0.85)' : 'rgba(15,23,42,0.6)';
  const valueFill = isDark ? '#ffffff' : '#0f172a';
  const pctFill = isDark ? 'rgba(255,255,255,0.95)' : '#0f172a';
  const railFill = isDark ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.12)';
  const strokePoly = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(15, 23, 42, 0.1)';

  const taxaGeral = page > 0 ? (pur / page) * 100 : 0;
  const taxaStr = taxaGeral.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="w-full select-none outline-none focus:outline-none -mx-1">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto max-h-[min(480px,70vh)] block"
        role="img"
        aria-label="Funil: PageView, Lead, InitiateCheckout, Compras"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          {SEG_STOPS.map((st, i) => (
            <linearGradient key={`seg${i}`} id={`funnelSeg${i}`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={st.a} />
              <stop offset="55%" stopColor={st.b} />
              <stop offset="100%" stopColor={st.c} />
            </linearGradient>
          ))}
          {stages.map((_, i) => {
            const g = layer(i);
            const pts = `${g.x0l},${g.y0} ${g.x0r},${g.y0} ${g.x1r},${g.y1} ${g.x1l},${g.y1}`;
            return (
              <clipPath key={`c${i}`} id={`funnelClip${i}`}>
                <polygon points={pts} />
              </clipPath>
            );
          })}
        </defs>

        {stages.map((s, i) => {
          const g = layer(i);
          const pts = `${g.x0l},${g.y0} ${g.x0r},${g.y0} ${g.x1r},${g.y1} ${g.x1l},${g.y1}`;
          const xText = contentTextCenter(g, ICON_RAIL);
          const xPct = Math.max(g.x0r, g.x1r) - 14;
          const longLabel = s.label.length > 14;
          const share = top <= 0 ? '0,0%' : i === 0 ? '100,0%' : fmtPctOfTop(s.value, top);
          const railW = ICON_RAIL - 8;

          return (
            <g key={s.key}>
              <polygon
                points={pts}
                fill={isDark ? `url(#funnelSeg${i})` : `url(#funnelSeg${i})`}
                fillOpacity={isDark ? 1 : 0.9}
                stroke={strokePoly}
                strokeWidth="1"
              />
              <rect
                x={g.x0l + 4}
                y={g.y0 + 2}
                width={railW}
                height={g.y1 - g.y0 - 4}
                rx="6"
                fill={railFill}
                clipPath={`url(#funnelClip${i})`}
                stroke="none"
              />
              <FunnelIcon kind={s.icon} x={g.x0l + 4 + railW / 2} y={g.midY} />

              <text
                x={xText}
                y={g.midY - 10}
                textAnchor="middle"
                fill={labelFill}
                fontSize={longLabel ? 16 : 18}
                fontWeight="600"
                fontFamily="system-ui, 'Segoe UI', Inter, sans-serif"
              >
                {s.label}
              </text>
              <text
                x={xText}
                y={g.midY + 20}
                textAnchor="middle"
                fill={valueFill}
                fontSize="32"
                fontWeight="800"
                fontFamily="system-ui, 'Segoe UI', Inter, sans-serif"
              >
                {fmtCount(s.value)}
              </text>
              <text
                x={xPct}
                y={g.midY + 5}
                textAnchor="end"
                fill={pctFill}
                fontSize="20"
                fontWeight="800"
                fontFamily="system-ui, 'Segoe UI', Inter, sans-serif"
              >
                {share}
              </text>
            </g>
          );
        })}

        <g transform={`translate(${W / 2} ${H - 44})`}>
          <rect
            x="-195"
            y="-17"
            width="390"
            height="36"
            rx="18"
            fill={isDark ? 'rgba(15, 20, 18, 0.85)' : 'rgba(255,255,255,0.95)'}
            stroke={isDark ? 'rgba(124, 58, 237, 0.5)' : 'rgba(124, 58, 237, 0.28)'}
            strokeWidth="1"
          />
          <text
            x="0"
            y="5"
            textAnchor="middle"
            fill={isDark ? 'rgba(255,255,255,0.8)' : 'rgba(15,23,42,0.7)'}
            fontSize="15"
            fontWeight="500"
            fontFamily="system-ui, 'Segoe UI', Inter, sans-serif"
          >
            <tspan>Taxa de conversão geral: </tspan>
            <tspan fill={isDark ? '#d8b4fe' : '#5b21b6'} fontWeight="800">
              {taxaStr}%
            </tspan>
          </text>
        </g>
      </svg>
    </div>
  );
}
