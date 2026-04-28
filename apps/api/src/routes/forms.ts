import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { capiService, CapiService } from '../services/capi';
import { getClientIp } from '../lib/ip';
import { geoFromGeoipLite } from '../lib/request-geo';

const router = Router();

// Helper to extract first and last name from full name
function splitName(fullName: string): { fn?: string; ln?: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0) return {};
  if (parts.length === 1) return { fn: parts[0] };
  return {
    fn: parts[0],
    ln: parts.slice(1).join(' ')
  };
}

// List Forms
router.get('/sites/:siteId/forms', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });

  const site = await pool.query('SELECT id FROM sites WHERE id = $1 AND account_id = $2', [siteId, auth.accountId]);
  if (!site.rowCount) return res.status(404).json({ error: 'Site not found' });

  const result = await pool.query('SELECT id, public_id, site_id, name, config, created_at, updated_at FROM site_forms WHERE site_id = $1 ORDER BY created_at DESC', [siteId]);
  return res.json({ forms: result.rows });
});

// Create Form
router.post('/sites/:siteId/forms', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });

  const site = await pool.query('SELECT id FROM sites WHERE id = $1 AND account_id = $2', [siteId, auth.accountId]);
  if (!site.rowCount) return res.status(404).json({ error: 'Site not found' });

  const { name, config } = req.body;
  if (!name || !config) return res.status(400).json({ error: 'Name and config are required' });

  const result = await pool.query(
    'INSERT INTO site_forms (site_id, name, config) VALUES ($1, $2, $3) RETURNING *',
    [siteId, name, config]
  );
  return res.json({ form: result.rows[0] });
});

// Update Form
router.put('/sites/:siteId/forms/:id', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  const id = Number(req.params.id);
  if (!Number.isFinite(siteId) || !Number.isFinite(id)) return res.status(400).json({ error: 'Invalid ID' });

  const site = await pool.query('SELECT id FROM sites WHERE id = $1 AND account_id = $2', [siteId, auth.accountId]);
  if (!site.rowCount) return res.status(404).json({ error: 'Site not found' });

  const { name, config } = req.body;
  const result = await pool.query(
    'UPDATE site_forms SET name = $1, config = $2, updated_at = NOW() WHERE id = $3 AND site_id = $4 RETURNING *',
    [name, config, id, siteId]
  );
  if (!result.rowCount) return res.status(404).json({ error: 'Form not found' });
  return res.json({ form: result.rows[0] });
});

// Delete Form
router.delete('/sites/:siteId/forms/:id', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  const id = Number(req.params.id);
  if (!Number.isFinite(siteId) || !Number.isFinite(id)) return res.status(400).json({ error: 'Invalid ID' });

  const site = await pool.query('SELECT id FROM sites WHERE id = $1 AND account_id = $2', [siteId, auth.accountId]);
  if (!site.rowCount) return res.status(404).json({ error: 'Site not found' });

  await pool.query('DELETE FROM site_forms WHERE id = $1 AND site_id = $2', [id, siteId]);
  return res.json({ success: true });
});

// Public Submit Endpoint
router.post('/public/forms/:publicId/submit', async (req, res) => {
  const publicId = req.params.publicId;
  if (!publicId) return res.status(400).json({ error: 'Missing form ID' });

  try {
    const formRes = await pool.query('SELECT id, public_id, site_id, name, config, created_at, updated_at FROM site_forms WHERE public_id = $1', [publicId]);
    if (!formRes.rowCount) return res.status(404).json({ error: 'Form not found' });
    const form = formRes.rows[0];
    const config = form.config || {};
    const groupTagRaw =
      typeof config.group_tag === 'string'
        ? config.group_tag
        : typeof (config as any).groupTag === 'string'
          ? (config as any).groupTag
          : '';
    const groupTag = String(groupTagRaw || '').trim().slice(0, 160);

    // ── CAPI INTEGRATION ──
    const siteId = form.site_id;
    const siteRes = await pool.query('SELECT site_key FROM sites WHERE id = $1', [siteId]);
    if (siteRes.rowCount) {
      const siteKey = siteRes.rows[0].site_key;
      const body = req.body || {};

      // Normalize keys to lowercase + stripped
      const data: Record<string, string> = {};
      Object.keys(body).forEach(k => {
        data[k.toLowerCase().replace(/[^a-z0-9]/g, '')] = String(body[k]);
      });

      // Extract User Data
      const email = data['email'] || data['mail'] || data['e_mail'];
      const phone = data['phone'] || data['tel'] || data['telefone'] || data['celular'] || data['whatsapp'];

      let fn = data['fn'] || data['firstname'] || data['first_name'] || data['primeironome'] || data['primeiro_nome'];
      let ln = data['ln'] || data['lastname'] || data['last_name'] || data['sobrenome'] || data['ultimo_nome'];
      const name = data['name'] || data['nome'] || data['fullname'] || data['full_name'] || data['nomecompleto'];

      if (!fn && !ln && name) {
        const parts = splitName(name);
        if (parts.fn) fn = parts.fn;
        if (parts.ln) ln = parts.ln;
      }

      const userData: any = {
        client_ip_address: getClientIp(req),
        client_user_agent: req.headers['user-agent'] || undefined,
      };

      if (email) userData.em = CapiService.hash(email);
      if (phone) userData.ph = CapiService.hash(phone.replace(/\D/g, ''));
      if (fn) userData.fn = CapiService.hash(fn);
      if (ln) userData.ln = CapiService.hash(ln);
      // Maximizar correspondência: external_id estável (hash) quando houver email/phone.
      // (CapiService.externalIdForCapiPayload não re-hasheia se já for 64-hex.)
      userData.external_id =
        (typeof body.external_id === 'string' && body.external_id.trim())
          ? body.external_id.trim()
          : (email ? CapiService.hash(email) : phone ? CapiService.hash(phone.replace(/\D/g, '')) : undefined);
      // Se o frontend mandar cookies/ids, aproveita no fallback server-side.
      if (typeof body.fbp === 'string') userData.fbp = body.fbp;
      if (typeof body.fbc === 'string') userData.fbc = body.fbc;

      // ── Visitor Profile (site_visitors) ──
      // Sempre grava o perfil do lead (independente de tracked_by_frontend),
      // para poder propagar group_tag para compras futuras.
      try {
        const emailHash = email ? CapiService.hash(String(email).trim().toLowerCase()) : null;
        const phoneDigits = phone ? String(phone).replace(/\D/g, '') : '';
        const phoneHash = phoneDigits ? CapiService.hash(phoneDigits) : null;
        const externalId = typeof userData.external_id === 'string' && userData.external_id.trim()
          ? userData.external_id.trim()
          : (emailHash || phoneHash);

        if (externalId) {
          const lastIp = getClientIp(req) || null;
          const lastUa = (req.headers['user-agent'] as string | undefined) || null;
          const lastEventName = 'form_submit';
          const geo = lastIp ? geoFromGeoipLite(String(lastIp)) : null;
          const geoCity = geo?.city ? String(geo.city).trim().slice(0, 255) : null;
          const geoState = geo?.region ? String(geo.region).trim().slice(0, 255) : null;
          const geoCountry = geo?.country ? String(geo.country).trim().slice(0, 255) : null;

          await pool.query(
            `
              INSERT INTO site_visitors (
                site_key, external_id, fbc, fbp, email_hash, phone_hash,
                total_events, last_event_name, last_ip, last_user_agent,
                city, state, country,
                first_group_tag, last_group_tag, last_group_tag_at
              ) VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8, $9, $10, $11, $12, $13, $14, CASE WHEN $14::text IS NULL OR $14::text = '' THEN NULL ELSE NOW() END)
              ON CONFLICT (site_key, external_id) DO UPDATE SET
                fbc = COALESCE(EXCLUDED.fbc, site_visitors.fbc),
                fbp = COALESCE(EXCLUDED.fbp, site_visitors.fbp),
                email_hash = COALESCE(EXCLUDED.email_hash, site_visitors.email_hash),
                phone_hash = COALESCE(EXCLUDED.phone_hash, site_visitors.phone_hash),
                last_event_name = EXCLUDED.last_event_name,
                last_ip = COALESCE(EXCLUDED.last_ip, site_visitors.last_ip),
                last_user_agent = COALESCE(EXCLUDED.last_user_agent, site_visitors.last_user_agent),
                city = COALESCE(site_visitors.city, EXCLUDED.city),
                state = COALESCE(site_visitors.state, EXCLUDED.state),
                country = COALESCE(site_visitors.country, EXCLUDED.country),
                total_events = site_visitors.total_events + 1,
                last_seen_at = NOW(),
                first_group_tag = COALESCE(site_visitors.first_group_tag, EXCLUDED.first_group_tag),
                last_group_tag = COALESCE(NULLIF(EXCLUDED.last_group_tag, ''), site_visitors.last_group_tag),
                last_group_tag_at = CASE
                  WHEN NULLIF(EXCLUDED.last_group_tag, '') IS NULL THEN site_visitors.last_group_tag_at
                  WHEN site_visitors.last_group_tag IS DISTINCT FROM EXCLUDED.last_group_tag THEN NOW()
                  ELSE site_visitors.last_group_tag_at
                END
            `,
            [
              siteKey,
              externalId,
              typeof body.fbc === 'string' ? body.fbc : null,
              typeof body.fbp === 'string' ? body.fbp : null,
              emailHash,
              phoneHash,
              lastEventName,
              lastIp,
              lastUa,
              geoCity,
              geoState,
              geoCountry,
              groupTag || null,
              groupTag || null,
            ]
          );
        }
      } catch (err) {
        console.error(`[Forms] Failed to upsert site_visitors for form ${publicId}:`, err);
      }

      // Determine Event Name from Config (evento configurado para enviar ao Meta)
      let eventName = 'Lead';
      if (form.config?.event_type) {
        if (form.config.event_type === 'Custom') {
          const fromCfg = typeof form.config.custom_event_name === 'string' ? form.config.custom_event_name.trim() : '';
          const fromBody =
            typeof (req.body as any)?.meta_event_name === 'string' ? String((req.body as any).meta_event_name).trim() : '';
          // Se o nome custom não estiver salvo (vazio), aceitamos o nome enviado pelo gerador do formulário.
          eventName = fromCfg || fromBody || 'Lead';
        } else {
          eventName = form.config.event_type;
        }
      }

      // ── Auditoria: persiste o cadastro (lead audit) com os campos do formulário ──
      // Mesmo quando o frontend rastreia via /ingest, a submissão pública é a fonte confiável dos dados preenchidos.
      try {
        const eventTimeSec = Math.floor(Date.now() / 1000);
        const eventId =
          (typeof body.event_id === 'string' && body.event_id.trim())
            ? body.event_id.trim()
            : `lead_${eventTimeSec}_${Math.random().toString(36).slice(2, 8)}`;

        const referer = (req.headers.referer as string | undefined) || `https://form-submit.trakeamento.com/${publicId}`;
        const pageLocation =
          typeof (body as any)?.page_location === 'string' && String((body as any).page_location).trim()
            ? String((body as any).page_location).trim()
            : '';
        const eventSourceUrlForAudit = pageLocation || referer;

        // Guarda os campos (sem mexer no resto do tracking). Isso é auditoria, não CRM.
        const fieldsRaw =
          body && typeof body === 'object' && !Array.isArray(body)
            ? ((body as any).fields && typeof (body as any).fields === 'object' ? (body as any).fields : body)
            : {};

        const safeFields = Object.fromEntries(
          Object.entries(fieldsRaw || {}).filter(([k]) => !['tracked_by_frontend'].includes(String(k)))
        );

        const pickStr = (k: string) => (typeof (body as any)?.[k] === 'string' ? String((body as any)[k]).trim() : '');
        const urlParams = (() => {
          try {
            const u = new URL(eventSourceUrlForAudit);
            const p = u.searchParams;
            return {
              utm_source: p.get('utm_source') || '',
              utm_medium: p.get('utm_medium') || '',
              utm_campaign: p.get('utm_campaign') || '',
              utm_content: p.get('utm_content') || '',
              utm_term: p.get('utm_term') || '',
              click_id: p.get('click_id') || '',
              fbclid: p.get('fbclid') || '',
              gclid: p.get('gclid') || '',
              page_path: u.pathname || '',
              page_location: u.toString(),
            };
          } catch {
            return {
              utm_source: '',
              utm_medium: '',
              utm_campaign: '',
              utm_content: '',
              utm_term: '',
              click_id: '',
              fbclid: '',
              gclid: '',
              page_path: '',
              page_location: '',
            };
          }
        })();

        const fullNameFromFields =
          typeof (safeFields as any).fullname === 'string'
            ? String((safeFields as any).fullname).trim()
            : typeof (safeFields as any).name === 'string'
              ? String((safeFields as any).name).trim()
              : '';

        const auditTopLevel = {
          // Page context
          page_title: pickStr('page_title'),
          page_path: pickStr('page_path') || urlParams.page_path,
          page_location: pageLocation || urlParams.page_location,
          event_url: eventSourceUrlForAudit,
          // IDs
          fbclid: pickStr('fbclid') || urlParams.fbclid,
          gclid: pickStr('gclid') || urlParams.gclid,
          click_id: pickStr('click_id') || urlParams.click_id,
          // UTMs
          utm_source: pickStr('utm_source') || urlParams.utm_source,
          utm_medium: pickStr('utm_medium') || urlParams.utm_medium,
          utm_campaign: pickStr('utm_campaign') || urlParams.utm_campaign,
          utm_content: pickStr('utm_content') || urlParams.utm_content,
          utm_term: pickStr('utm_term') || urlParams.utm_term,
          traffic_source: pickStr('traffic_source') || pickStr('utm_source') || urlParams.utm_source,
        };

        await pool.query(
          `INSERT INTO web_events(
            site_key, event_id, event_name, event_time,
            event_source_url, user_data, custom_data, telemetry
          ) VALUES($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT(site_key, event_id) DO NOTHING`,
          [
            siteKey,
            eventId,
            eventName,
            new Date(eventTimeSec * 1000),
            eventSourceUrlForAudit,
            {
              client_ip_address: getClientIp(req),
              client_user_agent: req.headers['user-agent'] || undefined,
              external_id: userData.external_id,
              fbp: typeof body.fbp === 'string' ? body.fbp : undefined,
              fbc: typeof body.fbc === 'string' ? body.fbc : undefined,
            },
            {
              audit_kind: 'lead_audit',
              meta_event_name: eventName,
              form_id: publicId,
              form_name: form.name,
              group_tag: groupTag || null,
              name: name || fullNameFromFields || null,
              email: email || null,
              phone: phone || null,
              ...auditTopLevel,
              fields: safeFields,
            },
            null,
          ]
        );

        // Mantém no máximo 20 leads por site (auditoria)
        pool
          .query(
            `
            DELETE FROM web_events
            WHERE site_key = $1
              AND (custom_data->>'audit_kind') = 'lead_audit'
              AND id IN (
                SELECT id
                FROM web_events
                WHERE site_key = $1
                  AND (custom_data->>'audit_kind') = 'lead_audit'
                ORDER BY event_time DESC, id DESC
                OFFSET 20
              )
            `,
            [siteKey]
          )
          .catch(() => {});
      } catch (err) {
        console.error(`[Forms] Failed to persist Lead audit event for form ${publicId}:`, err);
      }

      // ── CAPI INTEGRATION (Fallback if frontend tracking failed or blocked) ──
      // Se o formulário enviou a flag `tracked_by_frontend`, significa que o sdk.ts já
      // enviou o evento para a rota /ingest com máxima qualidade (fbc, fbp, user_agent).
      // Disparar outro CAPI aqui criaria redundância e derrubaria o Score por falta de cookies.
      if (!body.tracked_by_frontend) {
        // Remove raw PII from custom_data to avoid Hash Warnings from Meta
        const piiKeys = ['email', 'mail', 'e_mail', 'phone', 'tel', 'telefone', 'celular', 'whatsapp', 'fn', 'firstname', 'first_name', 'primeironome', 'primeiro_nome', 'ln', 'lastname', 'last_name', 'sobrenome', 'ultimo_nome', 'name', 'nome', 'fullname', 'full_name', 'nomecompleto'];
        const safeCustomData = Object.fromEntries(
          Object.entries(body).filter(([k]) => !piiKeys.includes(k.toLowerCase().replace(/[^a-z0-9]/g, '')) && k !== 'event_id' && k !== 'tracked_by_frontend')
        );

        // Send Event (async)
        capiService.sendEventDetailed(siteKey, {
          event_name: eventName,
          event_time: Math.floor(Date.now() / 1000),
          event_id: body.event_id || `${eventName.toLowerCase()}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          event_source_url: req.headers.referer || `https://form-submit.trakeamento.com/${publicId}`,
          action_source: 'website',
          user_data: userData,
          custom_data: {
            form_name: form.name,
            form_id: publicId,
            ...safeCustomData
          }
        }).catch(err => console.error(`CAPI failed for form ${publicId}:`, err));
      }
    }

    // Trigger Webhook(s) if configured
    const webhookUrlsRaw = Array.isArray(config.webhook_urls) ? config.webhook_urls : [];
    const webhookUrls = webhookUrlsRaw
      .map((x: any) => String(x || '').trim())
      .filter(Boolean)
      .slice(0, 5);
    const legacyWebhookUrl = typeof config.webhook_url === 'string' ? config.webhook_url.trim() : '';
    if (legacyWebhookUrl && !webhookUrls.includes(legacyWebhookUrl)) webhookUrls.push(legacyWebhookUrl);

    if (webhookUrls.length) {
      try {
        const body = req.body || {};

        // Normalize keys (same approach as CAPI extraction)
        const data: Record<string, string> = {};
        Object.keys(body).forEach((k) => {
          data[k.toLowerCase().replace(/[^a-z0-9]/g, '')] = String((body as any)[k]);
        });

        const email = data['email'] || data['mail'] || data['e_mail'];
        const phone = data['phone'] || data['tel'] || data['telefone'] || data['celular'] || data['whatsapp'];
        const name =
          data['name'] || data['nome'] || data['fullname'] || data['full_name'] || data['nomecompleto'] || undefined;

        const payload = {
          // Meta / Trajettu metadata (stable)
          form_id: form.public_id,
          form_name: form.name,
          submitted_at: new Date().toISOString(),
          group_tag: groupTag || null,
          // Common “flat” fields (many CRMs require these at root)
          name: name || null,
          email: email || null,
          phone: phone || null,
          // Alternative shape (also common)
          fields: body,
          // Back-compat with previous versions
          data: body,
        };

        for (const url of webhookUrls) {
          const controller = new AbortController();
          const timeoutMs = 8000;
          const t = setTimeout(() => controller.abort(), timeoutMs);
          fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'User-Agent': 'Trajettu-FormsWebhook/1.0',
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
          })
            .then(async (r) => {
              clearTimeout(t);
              if (!r.ok) {
                const text = await r.text().catch(() => '');
                console.error(
                  `Webhook non-2xx for form ${publicId}: ${url} ${r.status} ${r.statusText} body=${text?.slice(0, 1200) || ''}`
                );
              }
            })
            .catch((err) => {
              clearTimeout(t);
              console.error(`Webhook failed for form ${publicId}: ${url}`, err);
            });
        }
      } catch (err) {
        console.error(`Webhook setup failed for form ${publicId}:`, err);
      }
    }

    return res.json({
      success: true,
      action: config.post_submit_action || 'message',
      message: config.post_submit_message || 'Obrigado! Dados recebidos.',
      redirect_url: config.post_submit_redirect_url || ''
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal error' });
  }
});

export const formsRouter = router;
