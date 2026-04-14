import { pool } from '../db/pool';

const LRUCache = require('lru-cache').LRUCache || require('lru-cache');

interface QuotaEntry {
  maxEvents: number;
  usedEvents: number;
  fetchedAt: number;
}

// Cache quota info per site_key for 5 minutes to avoid hitting DB on every event
const quotaCache = new LRUCache({
  max: 5000,
  ttl: 5 * 60 * 1000,
});

// Tracks in-flight increments between cache refreshes
const inflightCounts = new Map<string, number>();

/**
 * Check whether a site_key still has event quota left for the current billing month.
 * Returns { allowed: true } or { allowed: false, reason, limit, used }.
 *
 * Designed to be fast (cached) and non-blocking — a small over-count is acceptable
 * (soft enforcement); hard enforcement happens on the DB side via the GC/admin panel.
 */
export async function checkEventQuota(siteKey: string): Promise<
  { allowed: true } | { allowed: false; reason: string; limit: number; used: number }
> {
  let entry = quotaCache.get(siteKey) as QuotaEntry | undefined;

  if (!entry) {
    try {
      const { rows } = await pool.query<{ max_events: number; event_count: string }>(
        `SELECT COALESCE(p.max_events, 999999999) AS max_events,
                (SELECT COUNT(*)::text FROM web_events
                 WHERE site_key = $1
                   AND event_time >= date_trunc('month', NOW())
                ) AS event_count
         FROM sites s
         LEFT JOIN accounts a ON a.id = s.account_id
         LEFT JOIN plans p ON p.id = a.active_plan_id
         WHERE s.site_key = $1
         LIMIT 1`,
        [siteKey]
      );

      if (rows.length === 0) {
        // Unknown site — allow (will fail on INSERT due to FK anyway)
        return { allowed: true };
      }

      entry = {
        maxEvents: rows[0].max_events,
        usedEvents: parseInt(rows[0].event_count, 10) || 0,
        fetchedAt: Date.now(),
      };
      quotaCache.set(siteKey, entry);
      inflightCounts.set(siteKey, 0);
    } catch {
      // DB error — fail open (allow the event, don't break tracking)
      return { allowed: true };
    }
  }

  const inflight = inflightCounts.get(siteKey) ?? 0;
  const totalUsed = entry.usedEvents + inflight;

  if (totalUsed >= entry.maxEvents) {
    return {
      allowed: false,
      reason: 'monthly_event_limit_reached',
      limit: entry.maxEvents,
      used: totalUsed,
    };
  }

  // Increment in-flight counter (will reset on cache TTL refresh)
  inflightCounts.set(siteKey, inflight + 1);
  return { allowed: true };
}

/** Invalidate quota cache for a site (e.g. after plan upgrade). */
export function invalidateQuotaCache(siteKey: string): void {
  quotaCache.delete(siteKey);
  inflightCounts.delete(siteKey);
}
