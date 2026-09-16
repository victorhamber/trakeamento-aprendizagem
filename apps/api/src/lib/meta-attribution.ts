/**
 * fbc / fbp na Conversions API devem refletir o clique com fidelidade
 * (fbclid sem toLowerCase, truncar ou reescrever timestamp).
 * @see https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/fbp-and-fbc
 * @see https://developers.facebook.com/docs/marketing-api/conversions-api/parameter-builder-library
 */

export function preserveMetaClickIds(val: unknown): string | undefined {
  if (val == null) return undefined;
  if (typeof val !== 'string') return undefined;
  const t = val.trim();
  return t || undefined;
}

/** Appendix oficial do Param Builder: 8 chars no último segmento. */
export function isMetaParamBuilderAppendix(segment: string | undefined): boolean {
  return typeof segment === 'string' && segment.length === 8 && /^[A-Za-z0-9_-]+$/.test(segment);
}

export function parseMetaFbcParts(raw: string): {
  version: string;
  subdomainIndex: string;
  creationTime: string;
  fbclid: string;
  appendix?: string;
} | undefined {
  const t = raw.trim();
  if (!t.startsWith('fb.')) return undefined;
  const parts = t.split('.');
  if (parts.length < 4) return undefined;
  if (parts[0] !== 'fb') return undefined;
  if (!/^[0-9]+$/.test(parts[1]) || !/^[0-9]+$/.test(parts[2])) return undefined;

  let clickParts = parts.slice(3);
  let appendix: string | undefined;
  if (clickParts.length >= 2 && isMetaParamBuilderAppendix(clickParts[clickParts.length - 1])) {
    appendix = clickParts[clickParts.length - 1];
    clickParts = clickParts.slice(0, -1);
  }
  const fbclid = clickParts.join('.');
  if (!fbclid) return undefined;
  return {
    version: parts[0],
    subdomainIndex: parts[1],
    creationTime: parts[2],
    fbclid,
    appendix,
  };
}

export function parseMetaCookieTimestampMs(raw: string): number | undefined {
  const parsed = parseMetaFbcParts(raw);
  const tsRaw = parsed ? Number(parsed.creationTime) : Number(raw.split('.')[2]);
  if (!Number.isFinite(tsRaw) || tsRaw <= 0) return undefined;
  return tsRaw < 10_000_000_000 ? tsRaw * 1000 : tsRaw;
}

/**
 * Regras do Payload Helper / CAPI para `user_data.fbc`:
 * `fb.<subdomainIndex>.<creationTimeMs>.<fbclid>[.<appendix8>]`
 * O fbclid permanece com a caixa original; não pode ter espaço.
 */
export function isPayloadHelperValidFbc(val: unknown): boolean {
  if (typeof val !== 'string') return false;
  if (val !== val.trim()) return false;
  const parsed = parseMetaFbcParts(val);
  if (!parsed) return false;
  if (/\s/.test(parsed.fbclid)) return false;
  const ts = Number(parsed.creationTime);
  if (!Number.isFinite(ts) || ts <= 0) return false;
  return true;
}

/**
 * fbc deve representar clique recente (janela de 90 dias).
 * Quando expirado, é melhor omitir do payload para evitar alerta de qualidade.
 */
export function preserveFreshMetaFbc(val: unknown, maxAgeDays = 90): string | undefined {
  const t = preserveMetaClickIds(val);
  if (!t) return undefined;
  if (!isPayloadHelperValidFbc(t)) return undefined;

  const tsMs = parseMetaCookieTimestampMs(t);
  if (!tsMs) return undefined;

  const now = Date.now();
  const maxAgeMs = Math.max(1, maxAgeDays) * 24 * 60 * 60 * 1000;
  if (tsMs > now + 24 * 60 * 60 * 1000) return undefined;
  if (now - tsMs > maxAgeMs) return undefined;
  return t;
}

/**
 * Cookie/formato `fbc`: `fb.<subdomain>.<creation_time>.<fbclid>[.<appendix>]`.
 * O appendix do Param Builder NÃO faz parte do fbclid.
 */
export function fbclidFromFbcCookie(fbc: string | null | undefined): string | undefined {
  const t = typeof fbc === 'string' ? fbc.trim() : '';
  if (!t) return undefined;
  return parseMetaFbcParts(t)?.fbclid;
}

function coreFbcWithoutAppendix(fbc: string): string | undefined {
  const parsed = parseMetaFbcParts(fbc);
  if (!parsed) return undefined;
  return `fb.${parsed.subdomainIndex}.${parsed.creationTime}.${parsed.fbclid}`;
}

/**
 * Decide qual fbc enviar ao CAPI.
 * Nunca altera o fbclid do cookie `_fbc` nem o da query `fbclid`.
 * Só troca o valor quando a URL traz um clique diferente do cookie.
 */
export function preferUnmodifiedFbc(
  existing: string | undefined | null,
  built: string | undefined | null,
  urlFbclid: string | undefined | null
): string | undefined {
  const ex = preserveFreshMetaFbc(existing);
  const bu = preserveFreshMetaFbc(built);
  const urlId = typeof urlFbclid === 'string' && urlFbclid.length > 0 ? urlFbclid : undefined;

  if (ex) {
    const exId = fbclidFromFbcCookie(ex);
    if (!urlId || exId === urlId) {
      if (bu) {
        const buId = fbclidFromFbcCookie(bu);
        if (buId === exId && coreFbcWithoutAppendix(ex) === coreFbcWithoutAppendix(bu)) {
          return bu;
        }
      }
      return ex;
    }
    if (bu) {
      const buId = fbclidFromFbcCookie(bu);
      if (buId === urlId) return bu;
    }
    return ex;
  }

  if (bu) {
    const buId = fbclidFromFbcCookie(bu);
    if (!urlId || buId === urlId) return bu;
  }

  return bu || ex;
}

export function fbclidFromEventSourceUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  try {
    if (!url.startsWith('http://') && !url.startsWith('https://')) return undefined;
    const v = new URL(url).searchParams.get('fbclid');
    return v && v.length > 0 ? v : undefined;
  } catch {
    return undefined;
  }
}
