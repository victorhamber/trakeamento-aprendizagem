import crypto from 'crypto';

/** Códigos ISO 3166-1 alpha-2 se `Intl.supportedValuesOf` não existir (Node antigo). */
const FALLBACK_ISO2 = [
  'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT', 'AU', 'AW', 'AX', 'AZ',
  'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS',
  'BT', 'BV', 'BW', 'BY', 'BZ', 'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN',
  'CO', 'CR', 'CU', 'CV', 'CW', 'CX', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ', 'EC', 'EE',
  'EG', 'EH', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FK', 'FM', 'FO', 'FR', 'GA', 'GB', 'GD', 'GE', 'GF',
  'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT', 'GU', 'GW', 'GY', 'HK', 'HM',
  'HN', 'HR', 'HT', 'HU', 'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT', 'JE', 'JM',
  'JO', 'JP', 'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW', 'KY', 'KZ', 'LA', 'LB', 'LC',
  'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK',
  'ML', 'MM', 'MN', 'MO', 'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ', 'NA',
  'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ', 'OM', 'PA', 'PE', 'PF', 'PG',
  'PH', 'PK', 'PL', 'PM', 'PN', 'PR', 'PS', 'PT', 'PW', 'PY', 'QA', 'RE', 'RO', 'RS', 'RU', 'RW',
  'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS',
  'ST', 'SV', 'SX', 'SY', 'SZ', 'TC', 'TD', 'TF', 'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN', 'TO',
  'TR', 'TT', 'TV', 'TW', 'TZ', 'UA', 'UG', 'UM', 'US', 'UY', 'UZ', 'VA', 'VC', 'VE', 'VG', 'VI',
  'VN', 'VU', 'WF', 'WS', 'YE', 'YT', 'ZA', 'ZM', 'ZW',
];

let hashToIsoUpper: Map<string, string> | null = null;

function metaCountryHash(isoUpper: string): string {
  return crypto.createHash('sha256').update(isoUpper.toLowerCase(), 'utf8').digest('hex');
}

function allIsoAlpha2Upper(): string[] {
  try {
    const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
    if (typeof intl.supportedValuesOf === 'function') {
      return intl.supportedValuesOf('region').filter((c) => c.length === 2 && /^[A-Z]{2}$/.test(c));
    }
  } catch {
    /* ignore */
  }
  return [...FALLBACK_ISO2];
}

function getHashToIsoMap(): Map<string, string> {
  if (hashToIsoUpper) return hashToIsoUpper;
  const m = new Map<string, string>();
  for (const code of allIsoAlpha2Upper()) {
    m.set(metaCountryHash(code), code);
  }
  hashToIsoUpper = m;
  return m;
}

const regionNamesPt = new Intl.DisplayNames(['pt-BR'], { type: 'region' });

/**
 * Converte `user_data.country` do pixel (hash SHA-256 de ISO2 minúsculo, ou ISO2 em texto)
 * em rótulo amigável. Retorna null se não for possível interpretar.
 */
export function resolvePixelCountryToken(token: string | null | undefined): string | null {
  if (token == null || typeof token !== 'string') return null;
  const t = token.trim();
  if (!t) return null;

  if (/^[a-f0-9]{64}$/i.test(t)) {
    const iso = getHashToIsoMap().get(t.toLowerCase());
    if (!iso) return null;
    try {
      const name = regionNamesPt.of(iso);
      return name ? `${name} (${iso}) · pixel` : `${iso} · pixel`;
    } catch {
      return `${iso} · pixel`;
    }
  }

  if (/^[a-z]{2}$/i.test(t)) {
    const iso = t.toUpperCase();
    try {
      const name = regionNamesPt.of(iso);
      return name ? `${name} (${iso}) · pixel` : `${iso} · pixel`;
    } catch {
      return `${iso} · pixel`;
    }
  }

  return null;
}
