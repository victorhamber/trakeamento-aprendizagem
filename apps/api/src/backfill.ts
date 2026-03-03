import { pool } from './db/pool';
import { createHash } from 'crypto';

function hashPii(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const v = value.trim();
    if (!v) return undefined;
    if (/^[0-9a-f]{64}$/i.test(v)) return v.toLowerCase();
    return createHash('sha256').update(v).digest('hex');
}

async function backfill() {
    console.log('Starting Backfill of site_visitors from web_events...');
    let offset = 0;
    const limit = 5000;
    let totalProcessed = 0;
    let totalUpserted = 0;

    while (true) {
        const res = await pool.query(
            'SELECT * FROM web_events ORDER BY id ASC LIMIT $1 OFFSET $2',
            [limit, offset]
        );

        if (res.rowCount === 0) break;

        for (const event of res.rows) {
            totalProcessed++;
            const userData = event.user_data || {};
            const customData = event.custom_data || {};
            const siteKey = event.site_key;
            const eventName = event.event_name;

            // Extract and format CAPI-like identifiers
            const fbc = userData.fbc || customData.fbc;
            const fbp = userData.fbp || customData.fbp;

            let em = userData.em;
            if (Array.isArray(em)) em = em[0];
            if (em && !/^[0-9a-f]{64}$/i.test(em)) em = hashPii(em);

            let ph = userData.ph;
            if (Array.isArray(ph)) ph = ph[0];
            if (ph && !/^[0-9a-f]{64}$/i.test(ph)) ph = hashPii(ph);

            let fn = userData.fn;
            if (Array.isArray(fn)) fn = fn[0];
            if (fn && !/^[0-9a-f]{64}$/i.test(fn)) fn = hashPii(fn);

            let ln = userData.ln;
            if (Array.isArray(ln)) ln = ln[0];
            if (ln && !/^[0-9a-f]{64}$/i.test(ln)) ln = hashPii(ln);

            let externalIdRaw = userData.external_id || customData.external_id;
            let extId = Array.isArray(externalIdRaw) ? externalIdRaw[0] : externalIdRaw;
            if (extId) extId = hashPii(String(extId));
            else extId = `anon_${event.event_id}`;

            const ts = customData.ta_ts ? String(customData.ta_ts) : undefined;

            try {
                await pool.query(`
          INSERT INTO site_visitors (
            site_key, external_id, fbc, fbp, email_hash, phone_hash, first_name_hash, last_name_hash, last_traffic_source, total_events, last_event_name, last_seen_at, created_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, 1, $10, $11, $11
          )
          ON CONFLICT (site_key, external_id) DO UPDATE SET
            fbc = COALESCE(EXCLUDED.fbc, site_visitors.fbc),
            fbp = COALESCE(EXCLUDED.fbp, site_visitors.fbp),
            email_hash = COALESCE(EXCLUDED.email_hash, site_visitors.email_hash),
            phone_hash = COALESCE(EXCLUDED.phone_hash, site_visitors.phone_hash),
            first_name_hash = COALESCE(EXCLUDED.first_name_hash, site_visitors.first_name_hash),
            last_name_hash = COALESCE(EXCLUDED.last_name_hash, site_visitors.last_name_hash),
            last_traffic_source = COALESCE(EXCLUDED.last_traffic_source, site_visitors.last_traffic_source),
            last_event_name = EXCLUDED.last_event_name,
            total_events = site_visitors.total_events + 1,
            last_seen_at = GREATEST(site_visitors.last_seen_at, EXCLUDED.last_seen_at)
        `, [
                    siteKey, extId, fbc, fbp, em, ph, fn, ln, ts, eventName, event.event_time
                ]);
                totalUpserted++;
            } catch (err) {
                console.error('Error upserting backfill:', err);
            }
        }

        offset += limit;
        console.log(`Processed ${totalProcessed} events...`);
    }

    console.log(`✅ Backfill Complete. Processed ${totalProcessed} raw events into ${totalUpserted} profile updates/inserts.`);
    process.exit(0);
}

backfill();
