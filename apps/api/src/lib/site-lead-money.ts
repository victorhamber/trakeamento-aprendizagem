import { pool } from '../db/pool';
import { normalizeMetaCurrencyCode, parseMetaEventValue } from './meta-currency';

type SiteLeadMoney = { value: number; currency: string };

const cache = new Map<string, { at: number; money: SiteLeadMoney | null }>();
const TTL_MS = 15 * 60 * 1000;

/**
 * Valor estimado do Lead para o site (ticket mediano das compras recentes,
 * ou value configurado numa regra Lead). A Meta rejeita value=0 no diagnóstico de ROAS.
 */
export async function resolveSiteLeadMoney(siteKey: string): Promise<SiteLeadMoney | null> {
  const key = String(siteKey || '').trim();
  if (!key) return null;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.money;

  let money: SiteLeadMoney | null = null;
  try {
    const purchases = await pool.query(
      `SELECT
          percentile_cont(0.5) WITHIN GROUP (ORDER BY amount::float) AS median_amount,
          MODE() WITHIN GROUP (ORDER BY UPPER(BTRIM(currency))) AS currency
         FROM purchases
        WHERE site_key = $1
          AND LOWER(BTRIM(COALESCE(status, ''))) IN ('approved', 'paid', 'completed', 'active')
          AND amount IS NOT NULL
          AND amount::float > 0
          AND COALESCE(platform_date, created_at) >= NOW() - INTERVAL '90 days'`,
      [key]
    );
    const median = Number(purchases.rows[0]?.median_amount);
    if (Number.isFinite(median) && median > 0) {
      money = {
        value: Math.round(median * 100) / 100,
        currency: normalizeMetaCurrencyCode(purchases.rows[0]?.currency),
      };
    }
  } catch {
    /* tabela/coluna pode faltar em ambiente novo */
  }

  if (!money) {
    try {
      const rules = await pool.query(
        `SELECT ur.parameters
           FROM site_url_rules ur
           JOIN sites s ON s.id = ur.site_id
          WHERE s.site_key = $1
            AND ur.event_name IN ('Lead', 'CompleteRegistration', 'Subscribe', 'Contact', 'Schedule')
          ORDER BY ur.id DESC
          LIMIT 20`,
        [key]
      );
      for (const row of rules.rows) {
        const params = row.parameters && typeof row.parameters === 'object' ? row.parameters : {};
        const v = parseMetaEventValue((params as { value?: unknown }).value);
        if (v !== undefined && v > 0) {
          money = {
            value: v,
            currency: normalizeMetaCurrencyCode((params as { currency?: unknown }).currency),
          };
          break;
        }
      }
    } catch {
      /* ignore */
    }
  }

  cache.set(key, { at: Date.now(), money });
  return money;
}
