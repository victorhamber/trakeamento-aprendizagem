/**
 * Presets do funil / insights usam o calendário deste fuso — evita "Hoje" virar o dia UTC no Docker.
 * Defina META_INSIGHTS_TIMEZONE (ex.: America/Sao_Paulo, America/Mexico_City).
 */
export function getMetaReportTimeZone(): string {
  const t = process.env.META_INSIGHTS_TIMEZONE?.trim();
  return t || 'America/Sao_Paulo';
}

export function getYmdInReportTz(iso: Date, tz: string): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: tz }).format(iso).slice(0, 10);
}

export function addDaysToYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map((x) => parseInt(x, 10));
  const x = new Date(Date.UTC(y, m - 1, d + deltaDays));
  const yy = x.getUTCFullYear();
  const mm = String(x.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(x.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** Dias civis inclusivos entre duas datas YYYY-MM-DD (ordem normalizada). */
export function calendarDaysInclusive(ymdStart: string, ymdEnd: string): number {
  if (ymdStart > ymdEnd) return calendarDaysInclusive(ymdEnd, ymdStart);
  let n = 0;
  let cur = ymdStart;
  while (cur <= ymdEnd) {
    n++;
    cur = addDaysToYmd(cur, 1);
    if (n > 5000) break;
  }
  return n;
}

/** Primeiro instante UTC do dia civil `ymd` em `tz` (meia-noite local, ou primeiro tick do dia). */
export function startOfZonedDayUtc(ymd: string, tz: string): Date {
  const [Y, M, D] = ymd.split('-').map(Number);
  const center = Date.UTC(Y, M - 1, D, 12, 0, 0);
  let first: Date | null = null;
  for (let h = -56; h <= 56; h++) {
    const d = new Date(center + h * 3600000);
    if (getYmdInReportTz(d, tz) !== ymd) continue;
    if (!first || d.getTime() < first.getTime()) first = d;
  }
  if (!first) {
    throw new Error(`startOfZonedDayUtc: no instant for ${ymd} in ${tz}`);
  }
  return first;
}
