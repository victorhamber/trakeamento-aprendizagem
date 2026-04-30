import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import { pool } from '../db/pool';
import { getClientIp } from '../lib/ip';
import { resolveServerGeoHint } from '../lib/request-geo';

const router = Router();

function readMetaClientParamBuilderBundle(): string {
  try {
    const pkgJson = require.resolve('meta-capi-param-builder-clientjs/package.json');
    const bundlePath = path.join(path.dirname(pkgJson), 'dist', 'clientParamBuilder.bundle.js');
    return fs.readFileSync(bundlePath, 'utf8');
  } catch {
    return '';
  }
}

const META_PARAM_BUILDER_BUNDLE = readMetaClientParamBuilderBundle();

router.get('/meta-param-builder.js', (_req, res) => {
  if (!META_PARAM_BUILDER_BUNDLE.length) {
    return res.status(404).type('text/plain').send('Meta parameter builder bundle not available');
  }
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.send(META_PARAM_BUILDER_BUNDLE);
});

/**
 * Carrega tracker.js o quanto antes, mas permite diferir "códigos extras" (snippets injetados)
 * até a primeira interação — evita perder amostragem do Meta (pixel + CAPI) em páginas com bounce.
 * Exceção: URLs com ta_pick ou ta_test (modo seletor / teste no painel) injetam sem deferir extras.
 */
router.get('/loader.js', (req, res) => {
  const key = typeof req.query.key === 'string' ? req.query.key.trim() : '';
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=3600');

  if (!key) {
    return res.status(400).send("console.warn('[TRK] loader.js: parâmetro key ausente');");
  }

  const apiBase =
    process.env.PUBLIC_API_BASE_URL ||
    process.env.API_BASE_URL ||
    `${req.headers['x-forwarded-proto'] || req.protocol}://${req.headers['x-forwarded-host'] || req.get('host')}`;
  const trackerSrc = process.env.PUBLIC_SDK_URL || `${apiBase}/sdk/tracker.js`;
  const trackerUrl = `${trackerSrc}?key=${encodeURIComponent(key)}`;

  const js = `(function(){
  var u=${JSON.stringify(trackerUrl)};
  var done=false;
  function inject(deferExtras){
    if(done)return;
    done=true;
    try{
      if(deferExtras) window.__TA_DEFER_EXTRAS = true;
    }catch(_e){}
    var s=document.createElement('script');
    s.src=u;
    s.async=true;
    (document.head||document.documentElement).appendChild(s);
  }
  function needPickerOrTest(){
    try{
      var q=location.search||'';
      if(!q)return false;
      var raw=q.charAt(0)==='?'?q.slice(1):q;
      var p=new URLSearchParams(raw);
      return p.has('ta_pick')||p.has('ta_test');
    }catch(_e){return false;}
  }
  function afterLoad(){
    if(needPickerOrTest()){inject(false);return;}
    // Carrega o tracker cedo para não perder PageView/Meta; difere apenas os snippets extras.
    inject(true);
  }
  if(document.readyState==='complete' || document.readyState==='interactive') afterLoad();
  else document.addEventListener('DOMContentLoaded', afterLoad, { once:true });
  // Fallback: se algum browser/extensão impedir DOMContentLoaded, tenta no load.
  window.addEventListener('load', afterLoad, { once:true });
})();`;

  return res.send(js);
});

/**
 * Geo aproximada (IP + headers CDN + opcional GEO_IP_LOOKUP_URL) para preencher ct/st/country
 * nos cookies do tracker (advanced matching do Pixel), sem campos no formulário.
 */
router.get('/geo-for-matching', async (req, res) => {
  const key = typeof req.query.key === 'string' ? req.query.key.trim() : '';
  if (!key) {
    return res.status(400).json({ error: 'missing key' });
  }
  try {
    const siteRow = await pool.query('SELECT id FROM sites WHERE site_key = $1 LIMIT 1', [key]);
    if (!siteRow.rowCount) {
      return res.status(404).json({ error: 'unknown site' });
    }
    const hint = await resolveServerGeoHint(req, getClientIp(req));
    res.setHeader('Cache-Control', 'private, max-age=1800');
    return res.json({
      city: hint.city || '',
      region: hint.region || '',
      country: hint.country || '',
    });
  } catch (_e) {
    return res.status(500).json({ error: 'geo lookup failed' });
  }
});

router.get('/tracker.js', async (req, res) => {
  const siteKey = req.query.key as string;
  let configJs = '';

  if (siteKey) {
    try {
      const siteRow = await pool.query(
        'SELECT id, inject_head_html, inject_body_html FROM sites WHERE site_key = $1',
        [siteKey]
      );
      if (siteRow && siteRow.rowCount && siteRow.rowCount > 0) {
        const siteId = siteRow.rows[0].id;
        const injRow = siteRow.rows[0] as {
          inject_head_html?: string | null;
          inject_body_html?: string | null;
        };

        const meta = await pool.query('SELECT enabled, pixel_id FROM integrations_meta WHERE site_id = $1', [siteId]);
        const ga = await pool.query('SELECT enabled, measurement_id FROM integrations_ga WHERE site_id = $1', [siteId]);

        const metaRow = meta.rows[0] as { enabled?: boolean | null; pixel_id?: string | null } | undefined;
        const gaRow = ga.rows[0] as { enabled?: boolean | null; measurement_id?: string | null } | undefined;

        const metaPixelId = metaRow && metaRow.enabled === false ? null : typeof metaRow?.pixel_id === 'string' ? metaRow.pixel_id.trim() : null;
        const gaMeasurementId = gaRow && gaRow.enabled === false ? null : typeof gaRow?.measurement_id === 'string' ? gaRow.measurement_id.trim() : null;

        const rules = await pool.query(
          'SELECT id, rule_type, match_value, match_text, event_name, event_type, parameters FROM site_url_rules WHERE site_id = $1 ORDER BY id ASC',
          [siteId]
        );
        const eventRules = rules.rows;

        const apiUrl =
          process.env.PUBLIC_API_BASE_URL ||
          process.env.API_BASE_URL ||
          `${req.headers['x-forwarded-proto'] || req.protocol}://${req.headers['x-forwarded-host'] || req.get('host')}`;

        const rawSckMax = process.env.HOTMART_SCK_MAX_CHARS;
        let hotmartSckMaxChars: number | null = 280;
        if (rawSckMax !== undefined && rawSckMax !== '') {
          const n = parseInt(rawSckMax, 10);
          hotmartSckMaxChars = Number.isFinite(n) && n > 0 ? n : null;
        }

        const configObj: Record<string, unknown> = {
          apiUrl,
          siteKey,
          metaPixelId,
          gaMeasurementId,
          eventRules,
          /** Limite aproximado do campo sck da Hotmart; acima disso usa trk_ só com eid e manda fbp/fbc na query. Aumente com HOTMART_SCK_MAX_CHARS na API se a Hotmart permitir mais. */
          hotmartSckMaxChars,
        };
        const headSnip = typeof injRow.inject_head_html === 'string' ? injRow.inject_head_html.trim() : '';
        const bodySnip = typeof injRow.inject_body_html === 'string' ? injRow.inject_body_html.trim() : '';
        if (headSnip) configObj.injectHeadHtml = headSnip;
        if (bodySnip) configObj.injectBodyHtml = bodySnip;

        try {
          const sn = await pool.query(
            `SELECT id, name, position, html, enabled, sort_order
             FROM site_injected_snippets
             WHERE site_id = $1 AND enabled IS TRUE
             ORDER BY sort_order ASC, id ASC`,
            [siteId]
          );
          if (sn.rowCount) configObj.injectSnippets = sn.rows;
        } catch (_eSn) {
          // optional feature; ignore if table not present yet
        }

        // Base64 + atob: evita quebras de sintaxe no tracker quando regras/UTMs têm U+2028, aspas, */ , etc.
        const configB64 = Buffer.from(JSON.stringify(configObj), 'utf8').toString('base64');
        configJs = `window.TRACKING_CONFIG = JSON.parse(atob(${JSON.stringify(configB64)}));\n\n`;
      } else {
        configJs = `console.warn('[TRK] Site key not found');\n\n`;
      }
    } catch (e) {
      configJs = `console.error('[TRK] Error loading smart config');\n\n`;
    }
  }

  const sdkBase =
    process.env.PUBLIC_API_BASE_URL ||
    process.env.API_BASE_URL ||
    `${req.headers['x-forwarded-proto'] || req.protocol}://${req.headers['x-forwarded-host'] || req.get('host')}`;

  const metaPbLoader = `
// Meta Conversions API Parameter Builder (client-side)
// Carrega o bundle oficial (quando disponível) para manter _fbc/_fbp no formato recomendado pela Meta.
(function(){
  try {
    if (window.__TA_META_PB_LOADED) return;
    window.__TA_META_PB_LOADED = true;
    var s = document.createElement('script');
    s.async = true;
    s.src = ${JSON.stringify(`${sdkBase}/sdk/meta-param-builder.js`)};
    s.onload = function(){
      try {
        // O bundle expõe 'clientParamBuilder' (documentado pela Meta).
        if (window.clientParamBuilder && typeof window.clientParamBuilder.processAndCollectAllParams === 'function') {
          window.clientParamBuilder.processAndCollectAllParams();
        }
      } catch(_e) {}
    };
    (document.head || document.documentElement).appendChild(s);
  } catch(_e) {}
})();\n\n`;

  // Ponto e vírgula defensivo antes do IIFE (evita ASI rara se o config terminar com expressão ambígua).
  const js =
    configJs +
    metaPbLoader +
    `;
(function(){
  if (window.__TA_INITIALIZED) return;
  window.__TA_INITIALIZED = true;
  'use strict';

  // ─── Constants ────────────────────────────────────────────────────────────
  var COOKIE_TTL_2Y  = 60*60*24*365*2;
  var COOKIE_TTL_90D = 60*60*24*90;
  var STANDARD_EVENTS = ['AddPaymentInfo','AddToCart','AddToWishlist','CompleteRegistration',
    'Contact','CustomizeProduct','Donate','FindLocation','InitiateCheckout','Lead',
    'Purchase','Schedule','Search','StartTrial','SubmitApplication','Subscribe',
    'ViewContent','PageView'];

  // ─── State ────────────────────────────────────────────────────────────────
  var startMs      = Date.now();
  var maxScroll    = 0;
  var totalClicks  = 0;
  var ctaClicks    = 0;
  var lastScrollY  = 0;
  var scrollTimer  = null;
  var visibleMs    = 0;
  var hiddenSince  = null;
  var lastPath     = '';
  var metaLoaded   = false;
  var gaLoaded     = false;
  var _lastRuleFire = {};  // dedup: chave eventName ou eventName:rule:id — evita bloquear 2 botões com o mesmo evento
  var RULE_DEDUP_MS = 5000; // 5s cooldown por chave
  /** UTMs em links de checkout (ids fbc/fbp/fbclid não truncamos — quebraria atribuição). */
  var CHECKOUT_UTM_MAX   = 120;
  var CHECKOUT_ID_MAX    = 120;
  var CHECKOUT_TA_TS_MAX = 200;
  var webVitals    = { lcp: 0, fid: 0, cls: 0, fcp: 0 };
  var pageEngagementEventId = null;

  // ─── VSL Retention State ──────────────────────────────────────────────────
  var vslState = {
    found: false,
    duration: 0,       // seconds
    currentTime: 0,    // seconds
    maxPct: 0,         // highest % watched
    milestones: { 25: false, 50: false, 75: false, 100: false },
    videoElement: null  // reference to the tracked <video>
  };

  // ─── Cookie helpers ───────────────────────────────────────────────────────
  function getCookie(name) {
    try {
      var match = document.cookie.match(new RegExp('(^|; )' + name + '=([^;]*)'));
      if (match) return decodeURIComponent(match[2]);
    } catch (_e) {}
    return undefined;
  }

  function setCookie(name, value, maxAgeSeconds, sameSite) {
    try {
      var cookie = name + '=' + encodeURIComponent(value) + '; path=/; samesite=' + (sameSite || 'lax');
      if (maxAgeSeconds) cookie += '; max-age=' + String(maxAgeSeconds);
      // Adiciona Secure se https
      if (location.protocol === 'https:') cookie += '; secure';
      document.cookie = cookie;
    } catch(_e) {}
  }

  // ─── SHA-256 (Web Crypto) ─────────────────────────────────────────────────
  function sha256Hex(str, cb) {
    try {
      if (!str) return cb('');
      if (window.crypto && window.crypto.subtle && window.TextEncoder) {
        var enc = new TextEncoder().encode(str);
        window.crypto.subtle.digest('SHA-256', enc)
          .then(function(buf) { cb(toHex(buf)); })
          .catch(function() { cb(''); });
        return;
      }
    } catch(_e) {}
    cb('');
  }

  function toHex(buf) {
    try {
      var b   = new Uint8Array(buf);
      var out = '';
      for (var i = 0; i < b.length; i++) out += ('00' + b[i].toString(16)).slice(-2);
      return out;
    } catch(_e) { return ''; }
  }

  // ─── PII Normalizers (padrão Meta CAPI) ───────────────────────────────────
  function normEmail(v)     { return (v || '').toString().trim().toLowerCase(); }
  function normPhone(v)     {
    var digits = (v || '').toString().replace(/[^0-9]/g, '');
    if (!digits) return '';
    if (digits.length === 10 || digits.length === 11) return '55' + digits;
    return digits;
  }
  function normName(v)      { return (v || '').toString().trim().toLowerCase(); }
  function normCityState(v) { return (v || '').toString().trim().toLowerCase(); }
  function normZip(v)       { return (v || '').toString().trim().toLowerCase().replace(/\s+/g, ''); }
  function normDob(v)       { return (v || '').toString().replace(/[^0-9]/g, ''); } // YYYYMMDD
  /** ISO 3166-1 alpha-2 em minúsculas (ex.: br) — padrão Meta para country hasheado. */
  function normCountry(v) {
    var s = (v || '').toString().trim().toLowerCase().replace(/\s+/g, '');
    if (!s) return '';
    if (/^[a-z]{2}$/.test(s)) return s;
    if (s === 'brasil' || s === 'brazil') return 'br';
    if (s === 'portugal') return 'pt';
    if (s === 'usa' || s === 'us') return 'us';
    var m = s.match(/^[a-z]{2}-([a-z]{2})$/);
    if (m) return m[1];
    var letters = s.replace(/[^a-z]/g, '');
    if (letters.length === 2) return letters;
    return '';
  }

  // ─── Hashed cookie helpers ────────────────────────────────────────────────
  var _taAmRefreshTimer = null;
  function scheduleMetaAdvancedMatchingRefresh() {
    try {
      if (_taAmRefreshTimer) return;
      _taAmRefreshTimer = setTimeout(function() {
        _taAmRefreshTimer = null;
        try { refreshMetaFbqAdvancedMatching(); } catch(_e) {}
      }, 80);
    } catch(_e) {}
  }

  function setHashedCookie(cookieName, rawValue, normalizer) {
    try {
      var normalized = normalizer ? normalizer(rawValue) : (rawValue || '').toString();
      if (!normalized) return;
      sha256Hex(normalized, function(hash) {
        if (hash) {
          setCookie(cookieName, hash, COOKIE_TTL_2Y);
          // identify() pode ser chamado depois do Pixel já estar inicializado.
          // Como o hash é assíncrono, garantimos um refresh após o cookie existir.
          scheduleMetaAdvancedMatchingRefresh();
        }
      });
    } catch(_e) {}
  }

  function getMetaUserDataFromCookies() {
    var out = {};
    var fields = { em:'_ta_em', ph:'_ta_ph', fn:'_ta_fn', ln:'_ta_ln',
                   ct:'_ta_ct', st:'_ta_st', zp:'_ta_zp', db:'_ta_db', country:'_ta_country' };
    for (var k in fields) {
      var v = getCookie(fields[k]);
      if (v) out[k] = v;
    }
    // Incluir external_id e fbp para deduplicação no Meta Pixel
    var eid = getOrCreateExternalId();
    if (eid) out.external_id = eid;
    var fbp = getFbp();
    if (fbp) out.fbp = fbp;
    return out;
  }

  // ─── External ID ─────────────────────────────────────────────────────────
  function getOrCreateExternalId() {
    // 1. Tenta recuperar do cookie
    var v = getCookie('_ta_eid');
    if (v) return v;

    // 2. Se não existir, tenta recuperar do localStorage (persistência cross-session se cookies forem limpos)
    try {
      var ls = localStorage.getItem('_ta_eid');
      if (ls) {
        setCookie('_ta_eid', ls, COOKIE_TTL_2Y);
        return ls;
      }
    } catch(_e) {}

    // 3. Gera novo ID
    var id = 'eid_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    
    // 4. Salva em ambos (Cookie + LocalStorage) para redundância
    setCookie('_ta_eid', id, COOKIE_TTL_2Y);
    try { localStorage.setItem('_ta_eid', id); } catch(_e) {}
    
    return id;
  }

  // ─── FBC / FBP ───────────────────────────────────────────────────────────
  function getFbc() {
    try {
      var url     = new URL(location.href);
      var fbclid  = url.searchParams.get('fbclid');
      var fbc     = getCookie('_fbc');
      
      if (fbclid) {
        // fbclid deve ir idêntico à Meta (sem toLowerCase). Comparamos só o sufixo após o último "." do fbc.
        // Se o cookie tiver o mesmo clique com caixa errada, regeneramos com o valor da URL atual.
        if (fbc) {
          var lastDot = fbc.lastIndexOf('.');
          var suffix = lastDot >= 0 ? fbc.slice(lastDot + 1) : '';
          if (suffix === fbclid) return fbc;
        }
        var generated = 'fb.1.' + Date.now() + '.' + fbclid;
        setCookie('_fbc', generated, COOKIE_TTL_90D);
        return generated;
      }
      
      if (fbc) return fbc;
    } catch(_e) {}
    return undefined;
  }

  function getFbp() {
    // 1. Prioridade: cookie oficial do Meta Pixel (_fbp)
    var fbp = getCookie('_fbp');
    if (fbp) return fbp;
    // 2. Fallback: nosso cookie próprio (_ta_fbp) para quando o Pixel
    //    ainda não carregou ou está bloqueado por adblocker.
    //    NÃO sobrescrevemos o _fbp oficial para não confundir a atribuição do Meta.
    var taFbp = getCookie('_ta_fbp');
    if (taFbp) return taFbp;
    try {
      var generated = 'fb.1.' + Date.now() + '.' + Math.floor(Math.random() * 1e10);
      setCookie('_ta_fbp', generated, COOKIE_TTL_2Y);
      return generated;
    } catch(_e) {}
    return undefined;
  }

  // ─── Device Fingerprint (para deduplicação no servidor) ───────────────────
  function getDeviceFingerprint() {
    try {
      var parts = [
        navigator.userAgent || '',
        navigator.language  || '',
        String(screen.width) + 'x' + String(screen.height),
        String(screen.colorDepth),
        Intl ? Intl.DateTimeFormat().resolvedOptions().timeZone || '' : '',
        navigator.hardwareConcurrency ? String(navigator.hardwareConcurrency) : '',
        navigator.deviceMemory         ? String(navigator.deviceMemory) : ''
      ];
      return parts.join('|');
    } catch(_e) { return ''; }
  }

  var _fingerprintHash = null;
  function getFingerprintHash(cb) {
    if (_fingerprintHash) return cb(_fingerprintHash);
    
    var done = false;
    var safeCb = function(val) {
      if (done) return;
      done = true;
      _fingerprintHash = val;
      cb(val);
    };

    // Fallback de segurança se crypto demorar > 200ms
    setTimeout(function() { safeCb(''); }, 200);

    sha256Hex(getDeviceFingerprint(), safeCb);
  }

  // ─── Traffic Source Persistence ───────────────────────────────────────────
  function getTrafficSource() {
    var cookieName = '_ta_ts';
    try {
      var url = new URL(location.href);
      
      // 1. Cross-domain forwarding via URL param (Highest priority for cross-domain jumps)
      var tsParam = url.searchParams.get('ta_ts');
      if (tsParam) {
        setCookie(cookieName, tsParam, COOKIE_TTL_90D);
        return tsParam;
      }

      // 2. Override with UTM Source if present
      var utmSource = url.searchParams.get('utm_source');
      if (utmSource) {
        setCookie(cookieName, utmSource, COOKIE_TTL_90D);
        return utmSource;
      }

      // 3. New external referrer (ONLY if not from same domain)
      if (document.referrer) {
        try {
          var refUrl = new URL(document.referrer);
          // Se vier de fora (ex: google.com, instagram.com) e não for o próprio site
          if (refUrl.hostname !== location.hostname) {
            setCookie(cookieName, document.referrer, COOKIE_TTL_90D);
            return document.referrer;
          }
        } catch(_e) {}
      }
    } catch(_e) {}

    // 4. Fallback to existing cookie
    var savedTs = getCookie(cookieName);
    if (savedTs) return savedTs;

    return '';
  }

  // ─── Attribution params ───────────────────────────────────────────────────
  // Reforço: URL > sessionStorage > cookie > localStorage > referrer (mesma origem) — Pixel/CAPI/checkout.
  // Redirecionamentos HTTP que tiram a query da barra costumam deixar document.referrer com a URL anterior
  // (mesmo host); não parseamos referrer cross-origin (evita utm forjado de sites externos).
  var ATTRIB_COOKIE = '_ta_attr';
  function persistAttributionBlob(obj) {
    try {
      var keys = ['utm_source','utm_medium','utm_campaign','utm_content','utm_term',
                  'click_id','gclid','ttclid','twclid','fbclid'];
      var slim = {};
      for (var wi = 0; wi < keys.length; wi++) {
        var wk = keys[wi];
        if (obj[wk]) slim[wk] = String(obj[wk]).slice(0, 400);
      }
      if (!Object.keys(slim).length) return;
      var js = JSON.stringify(slim);
      if (js.length >= 3500) return;
      setCookie(ATTRIB_COOKIE, js, COOKIE_TTL_90D);
      try { localStorage.setItem(ATTRIB_COOKIE, js); } catch(_ls) {}
    } catch (_pw) {}
  }
  function getAttributionParams() {
    var out  = {};
    var keys = ['utm_source','utm_medium','utm_campaign','utm_content','utm_term',
                'click_id','gclid','ttclid','twclid','fbclid'];
    try {
      var url = new URL(location.href);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var v = url.searchParams.get(k);
        if (v) {
          out[k] = v;
          try { sessionStorage.setItem('ta_' + k, v); } catch(_e) {}
        } else {
          try {
            var sv = sessionStorage.getItem('ta_' + k);
            if (sv) out[k] = sv;
          } catch(_e) {}
        }
      }
    } catch(_e) {}
    try {
      var rawC = getCookie(ATTRIB_COOKIE);
      if (rawC) {
        var parsed = JSON.parse(rawC);
        if (parsed && typeof parsed === 'object') {
          for (var ci = 0; ci < keys.length; ci++) {
            var ck = keys[ci];
            if (!out[ck] && parsed[ck]) out[ck] = String(parsed[ck]);
          }
        }
      }
    } catch (_ec) {}
    try {
      var rawLs = localStorage.getItem(ATTRIB_COOKIE);
      if (rawLs) {
        var pLs = JSON.parse(rawLs);
        if (pLs && typeof pLs === 'object') {
          for (var li = 0; li < keys.length; li++) {
            var lk = keys[li];
            if (!out[lk] && pLs[lk]) out[lk] = String(pLs[lk]);
          }
        }
      }
    } catch (_els) {}
    try {
      var refRaw = document.referrer;
      if (refRaw) {
        var refU = new URL(refRaw);
        if (refU.origin === location.origin) {
          for (var ri = 0; ri < keys.length; ri++) {
            var rk = keys[ri];
            if (out[rk]) continue;
            var rv = refU.searchParams.get(rk);
            if (rv) out[rk] = rv;
          }
        }
      }
    } catch (_er) {}
    // Cliques Meta/Google muitas vezes trazem só fbclid/gclid (sem utm_*). O painel e o checkout tratam isso como origem paga.
    try {
      if (out.fbclid && !out.click_id) out.click_id = out.fbclid;
      if (!out.utm_source && out.fbclid) {
        out.utm_source = 'facebook';
        if (!out.utm_medium) out.utm_medium = 'cpc';
      } else if (!out.utm_source && out.gclid) {
        out.utm_source = 'google';
        if (!out.utm_medium) out.utm_medium = 'cpc';
      } else if (!out.utm_source && out.ttclid) {
        out.utm_source = 'tiktok';
        if (!out.utm_medium) out.utm_medium = 'paid';
      } else if (!out.utm_source && out.twclid) {
        out.utm_source = 'twitter';
        if (!out.utm_medium) out.utm_medium = 'paid';
      }
    } catch (_e2) {}
    try {
      for (var si = 0; si < keys.length; si++) {
        var sk = keys[si];
        if (out[sk]) try { sessionStorage.setItem('ta_' + sk, String(out[sk])); } catch(_ss) {}
      }
      persistAttributionBlob(out);
    } catch (_e3) {}
    return out;
  }
  try { getAttributionParams(); } catch (_bootAttr) {}

  function truncateCheckoutParam(val, maxLen) {
    if (val == null || val === '') return '';
    var s = String(val);
    if (s.length <= maxLen) return s;
    return s.slice(0, maxLen);
  }

  /**
   * Anexa UTMs e ids ao checkout sem sobrescrever o que já veio no HTML/Hotmart.
   * UTMs vêm da land (URL ou sessionStorage); com tráfego Meta só fbclid/fbc, injeta utm_source/medium mínimos.
   */
  function mergeCheckoutAttributionQueryParams(url, eid, fbc, fbp) {
    try {
      var attrs = getAttributionParams();
      if (!attrs.utm_source && (attrs.fbclid || fbc)) {
        if (!attrs.utm_source) attrs.utm_source = 'facebook';
        if (!attrs.utm_medium) attrs.utm_medium = 'cpc';
      }
      var utmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
      for (var ui = 0; ui < utmKeys.length; ui++) {
        var uk = utmKeys[ui];
        var uv = attrs[uk];
        if (!uv) continue;
        if (!url.searchParams.has(uk)) {
          url.searchParams.set(uk, truncateCheckoutParam(uv, CHECKOUT_UTM_MAX));
        }
      }
      var idKeys = ['gclid', 'ttclid', 'twclid'];
      for (var ii = 0; ii < idKeys.length; ii++) {
        var ik = idKeys[ii];
        var iv = attrs[ik];
        if (!iv) continue;
        if (!url.searchParams.has(ik)) {
          url.searchParams.set(ik, truncateCheckoutParam(iv, CHECKOUT_ID_MAX));
        }
      }
      if (attrs.fbclid && !url.searchParams.has('fbclid')) {
        url.searchParams.set('fbclid', String(attrs.fbclid));
      }
      if (attrs.click_id && !url.searchParams.has('click_id')) {
        url.searchParams.set('click_id', truncateCheckoutParam(attrs.click_id, CHECKOUT_ID_MAX));
      }
      if (fbp && !url.searchParams.has('fbp')) url.searchParams.set('fbp', fbp);
      if (fbc && !url.searchParams.has('fbc')) url.searchParams.set('fbc', fbc);
      // external_id canônico (eid_) deve sempre estar no checkout.
      // Se já houver external_id mas não for eid_, sobrescrevemos para manter consistência.
      if (eid) {
        var existingEid = url.searchParams.get('external_id');
        if (!existingEid || existingEid.indexOf('eid_') !== 0) {
          url.searchParams.set('external_id', eid);
        }
      }
      var ts = getTrafficSource();
      if (ts && !url.searchParams.has('ta_ts')) {
        url.searchParams.set('ta_ts', truncateCheckoutParam(ts, CHECKOUT_TA_TS_MAX));
      }
    } catch (_e) {}
  }

  /** trk_ = base64(eid|fbc|fbp) como antes; se passar maxChars (Hotmart ~280), usa só eid|| — fbc/fbp ficam na query. */
  function buildHotmartTrkToken(eid, fbc, fbp, maxChars) {
    try {
      var payload = eid + '|' + (fbc || '') + '|' + (fbp || '');
      var full = 'trk_' + btoa(payload).replace(/=+$/, '');
      if (!maxChars || full.length <= maxChars) return full;
      var shortPayload = eid + '||';
      return 'trk_' + btoa(shortPayload).replace(/=+$/, '');
    } catch (_e) {
      return '';
    }
  }

  // ─── Connection / device info ─────────────────────────────────────────────
  function getDeviceInfo() {
    var out = {
      screen_width:   screen.width,
      screen_height:  screen.height,
      pixel_ratio:    Math.round((window.devicePixelRatio || 1) * 100) / 100,
      timezone:       '',
      language:       navigator.language || '',
      platform:       navigator.platform || '',
      connection_type: ''
    };
    try { out.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch(_e) {}
    try {
      var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (conn) out.connection_type = conn.effectiveType || conn.type || '';
    } catch(_e) {}
    return out;
  }

  // ─── Time helpers ─────────────────────────────────────────────────────────
  // event_time oficial do Meta continua em Unix UTC; só estes rótulos (dia/hora) são fuso do lead.
  function getTimeFields(epochSec) {
    try {
      var d = new Date(epochSec * 1000);
      if (typeof Intl !== 'undefined' && Intl.DateTimeFormat) {
        var tz = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
        var fmt = new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          hour: 'numeric',
          hour12: false
        });
        var parts = fmt.formatToParts(d);
        var map = {};
        for (var i = 0; i < parts.length; i++) {
          var p = parts[i];
          if (p.type !== 'literal') map[p.type] = p.value;
        }
        var h = parseInt(map.hour, 10);
        var dom = parseInt(map.day, 10);
        if (!isFinite(h) || !isFinite(dom)) throw new Error('bad time parts');
        return {
          event_day:           map.weekday,
          event_day_in_month:  dom,
          event_month:         map.month,
          event_time_interval: String(h) + '-' + String(h + 1),
          event_hour:          h
        };
      }
    } catch(_e) {}
    try {
      var d2 = new Date(epochSec * 1000);
      var daysfb = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
      var monthsfb = ['January','February','March','April','May','June','July',
        'August','September','October','November','December'];
      var hf = d2.getHours();
      return {
        event_day:           daysfb[d2.getDay()],
        event_day_in_month:  d2.getDate(),
        event_month:         monthsfb[d2.getMonth()],
        event_time_interval: String(hf) + '-' + String(hf + 1),
        event_hour:          hf
      };
    } catch(_e2) { return {}; }
  }

  function genEventId() {
    // Meta dedup exige que o ID do browser (eid) seja idêntico ao do server (event_id).
    // Mantemos um formato curto e URL-safe.
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  // ─── Page visibility (dwell real) ────────────────────────────────────────
  var lastVisibleAt = Date.now(); // timestamp de quando a aba ficou visível por último
  document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
      // Aba ficou escondida: acumula o tempo que estava visível
      visibleMs += Math.max(0, Date.now() - lastVisibleAt);
      hiddenSince = Date.now();
    } else {
      if (hiddenSince) {
        // Aba voltou: ajusta startMs para não contar tempo escondido no dwell
        startMs += (Date.now() - hiddenSince);
        hiddenSince = null;
      }
      lastVisibleAt = Date.now();
    }
  });

  // ─── Scroll tracking (throttled) ─────────────────────────────────────────
  function computeScrollPct() {
    try {
      var doc  = document.documentElement;
      var body = document.body;
      var scrollTop    = window.pageYOffset || doc.scrollTop || body.scrollTop || 0;
      var scrollHeight = Math.max(doc.scrollHeight, body.scrollHeight, 1);
      var clientHeight = Math.max(doc.clientHeight, body.clientHeight, 1);
      var denom        = Math.max(scrollHeight - clientHeight, 1);
      return Math.min(100, Math.max(0, (scrollTop / denom) * 100));
    } catch(_e) { return 0; }
  }

  window.addEventListener('scroll', function() {
    if (scrollTimer) return;
    scrollTimer = setTimeout(function() {
      scrollTimer = null;
      maxScroll = Math.max(maxScroll, computeScrollPct());
    }, 100);
  }, { passive: true });

  // ─── Click tracking ───────────────────────────────────────────────────────
  var CTA_TEXTS = ['comprar','quero comprar','saiba mais','falar no whatsapp',
                   'falar no whatsapp agora','buy now','add to cart','get started',
                   'sign up','subscribe','checkout','get offer','claim'];

  function isCta(el) {
    try {
      if (!el) return false;
      var tag  = (el.tagName || '').toUpperCase();
      var role = el.getAttribute && el.getAttribute('role');
      var cls  = (el.className || '').toString().toLowerCase();
      var txt  = (el.innerText || '').toString().trim().toLowerCase();
      if (tag === 'BUTTON') return true;
      if (tag === 'A' && el.getAttribute('href')) return true;
      if (role === 'button') return true;
      if (cls.indexOf('cta') >= 0 || cls.indexOf('btn') >= 0) return true;
      if (CTA_TEXTS.indexOf(txt) >= 0) return true;
    } catch(_e) {}
    return false;
  }

  document.addEventListener('click', function(e) {
    totalClicks++;
    try { checkButtonRules(e.target); } catch(_e) {}
    var el = e.target;
    while (el && el.tagName && el.tagName !== 'A' && el.tagName !== 'BUTTON') {
      el = el.parentElement;
    }
    if (isCta(el)) ctaClicks++;
  }, true);

  // ─── Auto-tag external links ──────────────────────────────────────────────
  document.addEventListener('click', function(e) {
    var el = e.target;
    while (el && el.tagName !== 'A') el = el.parentElement;
    if (!el || !el.href) return;
    try {
      var url = new URL(el.href);
      if (url.hostname === location.hostname) return;
      var fbp = getFbp();
      var fbc = getFbc();
      var eid = getOrCreateExternalId();
      var ts  = getTrafficSource();
      if (fbp) url.searchParams.set('fbp', fbp);
      if (fbc) url.searchParams.set('fbc', fbc);
      if (eid) url.searchParams.set('external_id', eid);
      if (ts)  url.searchParams.set('ta_ts', ts);
      var attrs = getAttributionParams();
      for (var k in attrs) { if (attrs[k]) url.searchParams.set(k, attrs[k]); }
      el.href = url.toString();
    } catch(_e) {}
  }, true);

  // ─── Form PII capture ────────────────────────────────────────────────────
  function maybeCaptureFromForm(form) {
    try {
      if (!form || !form.querySelectorAll) return;
      var inputs = form.querySelectorAll('input,select,textarea');
      for (var i = 0; i < inputs.length; i++) {
        var el   = inputs[i];
        if (!el || !el.value) continue;
        var meta = ((el.name || '') + ' ' + (el.id || '') + ' ' +
                    (el.getAttribute && el.getAttribute('autocomplete') || '')).toLowerCase();
        var type = ((el.type || '') + '').toLowerCase();
        var val  = el.value;

        if (type === 'email' || meta.indexOf('email') >= 0) {
          setHashedCookie('_ta_em', val, normEmail); continue;
        }
        if (type === 'tel' || /phone|telefone|cel|whats|fone/.test(meta)) {
          setHashedCookie('_ta_ph', val, normPhone); continue;
        }
        if (/first|nome|firstname/.test(meta)) {
          setHashedCookie('_ta_fn', val, normName); continue;
        }
        if (/last|sobrenome|lastname/.test(meta)) {
          setHashedCookie('_ta_ln', val, normName); continue;
        }
        if (/city|cidade/.test(meta)) {
          setHashedCookie('_ta_ct', val, normCityState); continue;
        }
        if (/state|estado|\\buf\\b/.test(meta)) {
          setHashedCookie('_ta_st', val, normCityState); continue;
        }
        if (/country|pais|país|country-name|country_code|countrycode/.test(meta)) {
          setHashedCookie('_ta_country', val, normCountry); continue;
        }
        if (/zip|cep|postal/.test(meta)) {
          setHashedCookie('_ta_zp', val, normZip); continue;
        }
        if (type === 'date' || /birth|nasc|\\bdob\\b/.test(meta)) {
          setHashedCookie('_ta_db', val, normDob); continue;
        }
      }
    } catch(_e) {}
  }

  document.addEventListener('submit', function(e) {
    try { maybeCaptureFromForm(e.target); } catch(_e) {}
  }, true);

  document.addEventListener('change', function(e) {
    try {
      var el = e.target;
      if (el && el.form) maybeCaptureFromForm(el.form);
    } catch(_e) {}
  }, true);

  // ─── taIdentify / autoExtract ────────────────────────────────────────────
  function coerceString(v) {
    if (v == null) return '';
    if (Array.isArray(v)) { for (var i = 0; i < v.length; i++) { var s = coerceString(v[i]); if (s) return s; } return ''; }
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return String(v);
    return '';
  }

  function autoExtractIdentify(raw) {
    var out  = { email:'', phone:'', fn:'', ln:'', ct:'', st:'', zp:'', db:'', country:'' };
    var seen = [];
    function consider(key, val) {
      var s = coerceString(val);
      if (!s) return;
      var k = (key || '').toString().toLowerCase();
      if (!out.email  && /email|e-mail/.test(k))                      { out.email = s; return; }
      if (!out.phone  && /phone|telefone|cel|whats|fone/.test(k))     { out.phone = s; return; }
      if (!out.fn     && /\\bfn\\b|first|\\bnome\\b|firstname/.test(k)) { out.fn    = s; return; }
      if (!out.ln     && /\\bln\\b|last|sobrenome|lastname/.test(k))    { out.ln    = s; return; }
      if (!out.ct     && /\\bct\\b|city|cidade/.test(k))                { out.ct    = s; return; }
      if (!out.st     && /\\bst\\b|state|estado|\\buf\\b/.test(k))      { out.st    = s; return; }
      if (!out.country && /country|pais|país|country_code|countrycode/.test(k)) { out.country = s; return; }
      if (!out.zp     && /\\bzp\\b|zip|cep|postal/.test(k))             { out.zp    = s; return; }
      if (!out.db     && /\\bdb\\b|birth|nasc|\\bdob\\b/.test(k))       { out.db    = s; return; }
    }
    function walk(obj, depth) {
      if (!obj || depth > 4) return;
      if (Array.isArray(obj)) { for (var i = 0; i < obj.length; i++) walk(obj[i], depth + 1); return; }
      if (typeof obj !== 'object') return;
      if (seen.indexOf(obj) >= 0) return;
      seen.push(obj);
      for (var k in obj) {
        if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
        var v = obj[k];
        consider(k, v);
        if (typeof v === 'object') walk(v, depth + 1);
      }
    }
    walk(raw, 0);
    return out;
  }

  function applyIdentify(raw) {
    try {
      if (!raw || typeof raw !== 'object') return;
      function pick(keys) {
        for (var i = 0; i < keys.length; i++) {
          var v = Object.prototype.hasOwnProperty.call(raw, keys[i]) ? raw[keys[i]] : undefined;
          var s = coerceString(v);
          if (s) return s;
        }
        return '';
      }
      var email = pick(['email','e-mail']);
      if (email) setHashedCookie('_ta_em', email, normEmail);
      var phone = pick(['phone','telefone','cel','whats','fone']);
      if (phone) setHashedCookie('_ta_ph', phone, normPhone);
      var fn = pick(['fn','first_name','firstname','nome']);
      if (fn) setHashedCookie('_ta_fn', fn, normName);
      var ln = pick(['ln','last_name','lastname','sobrenome']);
      if (ln) setHashedCookie('_ta_ln', ln, normName);
      var country = pick(['country','country_code','countryCode','pais','país']);
      if (country) setHashedCookie('_ta_country', country, normCountry);

      var auto = autoExtractIdentify(raw);
      if (!fn && auto.fn) setHashedCookie('_ta_fn', auto.fn, normName);
      if (!ln && auto.ln) setHashedCookie('_ta_ln', auto.ln, normName);
      if (auto.ct) setHashedCookie('_ta_ct', auto.ct, normCityState);
      if (auto.st) setHashedCookie('_ta_st', auto.st, normCityState);
      if (auto.country) setHashedCookie('_ta_country', auto.country, normCountry);
      if (auto.zp) setHashedCookie('_ta_zp', auto.zp, normZip);
      if (auto.db) setHashedCookie('_ta_db', auto.db, normDob);
    } catch(_e) {}
  }

  // ─── Meta Pixel loader ───────────────────────────────────────────────────
  function loadMetaPixel(pixelId) {
    try {
      if (!pixelId) return;
      var w = window;
      var inits = w._taFbqInits || (w._taFbqInits = {});
      if (!w.fbq) {
        !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
          n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
          n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
          t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}
          (window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
      }
      if (!inits[pixelId]) {
        var am = getMetaUserDataFromCookies();
        var fbcInit = getFbc();
        if (fbcInit) am.fbc = fbcInit;
        w.fbq('init', pixelId, am);
        inits[pixelId] = true;
      }
      metaLoaded = true;
    } catch(_e) {}
  }

  /** Atualiza advanced matching no fbq após novos cookies (_ta_ct / _ta_st / _ta_country). */
  function refreshMetaFbqAdvancedMatching() {
    try {
      var cfg = window.TRACKING_CONFIG;
      if (!window.fbq || !cfg || !cfg.metaPixelId) return;
      var am = getMetaUserDataFromCookies();
      var fbcInit = getFbc();
      if (fbcInit) am.fbc = fbcInit;
      if (Object.keys(am).length > 0) {
        window.fbq('init', cfg.metaPixelId, am);
      }
    } catch(_e) {}
  }

  /**
   * Busca cidade/estado/país no servidor (IP) e grava cookies hasheados se ainda vazios.
   * Cookie _ta_geo_hint_done (24h) evita chamadas repetidas.
   */
  function prefetchGeoForMatching() {
    try {
      var cfg = window.TRACKING_CONFIG;
      if (!cfg || !cfg.apiUrl || !cfg.siteKey) return;
      if (getCookie('_ta_geo_hint_done')) return;
      if (getCookie('_ta_ct') && getCookie('_ta_st') && getCookie('_ta_country')) {
        setCookie('_ta_geo_hint_done', '1', 86400);
        return;
      }
      var url = cfg.apiUrl + '/sdk/geo-for-matching?key=' + encodeURIComponent(cfg.siteKey);
      fetch(url, { mode: 'cors', credentials: 'omit' })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(j) {
          function finish() {
            setCookie('_ta_geo_hint_done', '1', 86400);
          }
          if (!j || typeof j !== 'object') {
            finish();
            return;
          }
          var pending = 0;
          function bump() {
            pending--;
            if (pending <= 0) {
              finish();
              refreshMetaFbqAdvancedMatching();
            }
          }
          function maybeSetGeoCookie(name, raw, norm) {
            if (getCookie(name)) return;
            var rs = (raw || '').toString().trim();
            if (!rs) return;
            var n = norm ? norm(rs) : rs;
            if (!n) return;
            pending++;
            sha256Hex(n, function(hash) {
              if (hash) setCookie(name, hash, COOKIE_TTL_2Y);
              bump();
            });
          }
          maybeSetGeoCookie('_ta_ct', j.city, normCityState);
          maybeSetGeoCookie('_ta_st', j.region, normCityState);
          maybeSetGeoCookie('_ta_country', j.country, normCountry);
          if (pending === 0) {
            finish();
            refreshMetaFbqAdvancedMatching();
          }
        })
        .catch(function() {
          setCookie('_ta_geo_hint_done', '1', 86400);
        });
    } catch(_e) {}
  }

  function trackMeta(eventName, params, eventId, isCustom) {
    try {
      if (!window.fbq) return;
      var opts = eventId ? { eventID: eventId } : {};
      if (isCustom) window.fbq('trackCustom', eventName, params || {}, opts);
      else          window.fbq('track', eventName, params || {}, opts);
      // console.log('[TRK] Meta event sent:', eventName);
    } catch(_e) {}
  }

  function hasFbq() {
    try { return typeof window.fbq === 'function'; } catch(_e) { return false; }
  }

  // ─── GA4 loader ───────────────────────────────────────────────────────────
  function loadGa(measurementId) {
    try {
      if (!measurementId || gaLoaded) return;
      gaLoaded = true;
      window.dataLayer = window.dataLayer || [];
      window.gtag = window.gtag || function() { window.dataLayer.push(arguments); };
      var s = document.createElement('script');
      s.async = true;
      s.src   = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(measurementId);
      var f = document.getElementsByTagName('script')[0];
      if (f && f.parentNode) f.parentNode.insertBefore(s, f);
      window.gtag('js', new Date());
      window.gtag('config', measurementId, { send_page_view: false });
    } catch(_e) {}
  }

  function trackGa(eventName, params) {
    try { if (window.gtag) window.gtag('event', eventName, params || {}); } catch(_e) {}
  }

  // ─── Payload builder ──────────────────────────────────────────────────────
  function buildUserData() {
    var metaUser  = getMetaUserDataFromCookies();
    var externalId = getOrCreateExternalId();
    var out = {
      client_user_agent: navigator.userAgent,
      fbp:        getFbp(),
      fbc:        getFbc(),
      external_id: externalId,
      em:  metaUser.em,
      ph:  metaUser.ph,
      fn:  metaUser.fn,
      ln:  metaUser.ln,
      ct:  metaUser.ct,
      st:  metaUser.st,
      zp:  metaUser.zp,
      db:  metaUser.db,
      country: metaUser.country
    };
    /**
     * taIdentify/applyIdentify grava cookies PII *assíncronas* (SHA-256). O track(Lead) costuma
     * correr no ms seguinte — cookies ainda vazias → CAPI/ingest sem fn/ln enquanto em ph às
     * vezes vinha de visita antiga. Mescla __TA_IDENTIFY (dados crus do último identify) se o
     * hash ainda não está no cookie. A API aplica o mesmo normalizador/hash.
     */
    try {
      var I = window.__TA_IDENTIFY;
      if (I && typeof I === 'object') {
        function pickId(keys) {
          for (var j = 0; j < keys.length; j++) {
            if (!Object.prototype.hasOwnProperty.call(I, keys[j])) continue;
            var t = (I[keys[j]] == null) ? '' : String(I[keys[j]]).trim();
            if (t) return t;
          }
          return '';
        }
        if (!out.em)  { var e0 = pickId(['email', 'e-mail', 'mail']);   if (e0) out.em  = e0; }
        if (!out.ph)  { var p0 = pickId(['phone', 'telefone', 'cel', 'celular', 'whats', 'whatsapp', 'whatsap', 'fone', 'zap', 'tel']); if (p0) out.ph = p0; }
        if (!out.fn)  { var f0 = pickId(['fn', 'first_name', 'firstname', 'nome', 'name']);   if (f0) out.fn  = f0; }
        if (!out.ln)  { var l0 = pickId(['ln', 'last_name', 'lastname', 'sobrenome', 'surname', 'ultimo_nome', 'ultimonome']);   if (l0) out.ln  = l0; }
        if (!out.ct)  { var c0 = pickId(['ct', 'city', 'cidade', 'municipio']);  if (c0) out.ct  = c0; }
        if (!out.st)  { var s0 = pickId(['st', 'estado', 'state', 'uf', 'regiao', 'region']);  if (s0) out.st  = s0; }
        if (!out.country)  { var co0 = pickId(['country', 'pais', 'país', 'countryCode', 'country_code']);  if (co0) out.country  = co0; }
        if (!out.zp)  { var z0 = pickId(['zip', 'cep', 'postal', 'postalcode', 'postal_code']);  if (z0) out.zp  = z0; }
      }
    } catch(_e) {}
    return out;
  }

  function buildTelemetry(extra) {
    var dwellMs = Math.max(0, Date.now() - startMs);
    var nav = performance && performance.timing ? performance.timing : null;
    var lt = nav && nav.loadEventEnd > 0 ? (nav.loadEventEnd - nav.navigationStart) : 
             (nav && nav.domContentLoadedEventEnd > 0 ? (nav.domContentLoadedEventEnd - nav.navigationStart) : 0);

    var base = Object.assign({
      dwell_time_ms:   dwellMs,
      visible_time_ms: visibleMs + (hiddenSince ? 0 : (Date.now() - startMs)),
      max_scroll_pct:  Math.round(maxScroll),
      load_time_ms:    lt > 0 ? lt : undefined,
      clicks_total:    totalClicks,
      clicks_cta:      ctaClicks,
      lcp:             Math.round(webVitals.lcp),
      fid:             Math.round(webVitals.fid),
      cls:             Math.round(webVitals.cls * 1000) / 1000,
      fcp:             Math.round(webVitals.fcp),
      pixel_loaded:    hasFbq(),
      pixel_id_present: !!(window.TRACKING_CONFIG && window.TRACKING_CONFIG.metaPixelId),
      page_path:       location.pathname || '',
      page_title:      document.title   || '',
      // VSL Retention fields
      vsl_found:       vslState.found,
      vsl_duration_s:  vslState.found ? Math.round(vslState.duration) : undefined,
      vsl_max_pct:     vslState.found ? Math.round(vslState.maxPct) : undefined,
      vsl_milestones:  vslState.found ? vslState.milestones : undefined,
    }, getDeviceInfo());
    return Object.assign(base, extra || {});
  }

  // ─── Send (fetch primary, beacon fallback) ─────────────────────────────
  function send(apiUrl, siteKey, payload, forceBeacon) {
    try {
      var url  = apiUrl + '/ingest/events?key=' + encodeURIComponent(siteKey);
      var body = JSON.stringify(payload);
      var ok = false;
      
      if (forceBeacon && navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }));
      }
      
      // Tenta fetch com keepalive primeiro (mais robusto hoje em dia)
      if (typeof fetch !== 'undefined') {
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body,
          keepalive: true,
          mode: 'cors'
        }).catch(function(){
          // Fallback sendBeacon APENAS se o fetch falhar completamente (sem rede).
          // NÃO fazemos retry no .then(!r.ok) — se o servidor recebeu o request
          // e retornou erro HTTP (502/503), ele já tem o body. Reenviar via
          // sendBeacon causaria duplicação pois geramos o mesmo event_id.
          if (navigator.sendBeacon) navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }));
        });
        ok = true;
      }
      
      if (!ok && navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }));
      }
    } catch(_e) { console.error('[TRK] Send error', _e); }
  }

  // ─── PageView ─────────────────────────────────────────────────────────────
  var _lastPageViewUrl = '';
  var _lastPageViewTime = 0;

  function pageView() {
    try {
      var cfg = window.TRACKING_CONFIG;
      if (!cfg || !cfg.apiUrl || !cfg.siteKey) return;
      
      var now = Date.now();
      var currentUrlNoHash = location.origin + location.pathname + location.search;

      // 1. Memory Debounce (prevent double fire within 1s on same URL, ignoring hash)
      if (_lastPageViewUrl === currentUrlNoHash && (now - _lastPageViewTime) < 1000) return;
      _lastPageViewUrl = currentUrlNoHash;
      _lastPageViewTime = now;

      // Dedup por estado global e Sessão: 
      // 1. Evita disparos duplos no mesmo instante (ex: script duplicado gtm + hardcode)
      // Dedup por estado global (Shared across scripts if any)
      if (window.__TA_PAGE_VIEW_URL === currentUrlNoHash) return;
      window.__TA_PAGE_VIEW_URL = currentUrlNoHash;

      // Memory debounce already covers double-fires in the same page lifecycle.
      // We removed sessionStorage deduplication to allow PageView on refresh (F5),
      // matching industry standards and the standard Meta Pixel behavior.

      var nav         = performance && performance.timing ? performance.timing : null;
      var loadTimeMs  = nav && nav.domContentLoadedEventEnd > 0 ? (nav.domContentLoadedEventEnd - nav.navigationStart) : undefined;
      if (loadTimeMs && loadTimeMs < 0) loadTimeMs = undefined;

      var attrs       = getAttributionParams();
      var eventTime   = Math.floor(Date.now() / 1000);
      var eventId     = genEventId();

      var telemetry = buildTelemetry({ page_path: location.pathname, page_title: document.title });
      var userData  = buildUserData();
      if (loadTimeMs) telemetry.load_time_ms = loadTimeMs;

      var payload = {
        event_name:        'PageView',
        event_time:        eventTime,
        event_id:          eventId,
        event_source_url:  location.href,
        action_source:     'website',
        user_data:         userData,
        custom_data:       Object.assign({
          page_title:    document.title,
          referrer:      document.referrer,
          traffic_source: getTrafficSource(),
          page_path:     location.pathname,
          // URL completa (inclui hash) — SPAs na raiz usam #/rota; sem hash o Meta/CAPI vê só o domínio.
          event_url:     location.href,
          page_location: location.href
        }, attrs),
        telemetry: telemetry
      };

      getFingerprintHash(function(fp) {
        payload.telemetry.device_fingerprint = fp;
        send(cfg.apiUrl, cfg.siteKey, payload);
      });

      if (cfg.metaPixelId) {
        loadMetaPixel(cfg.metaPixelId);
      }

      // Usando setTimeout(0) para garantir que o script injetado seja processado pelo browser
      // e o objeto fbq esteja disponível globalmente antes de chamar track.
      // Isso evita race conditions em mobile/safari onde a injeção síncrona pode falhar.
      setTimeout(function() {
        if (cfg.metaPixelId || hasFbq()) {
          trackMeta('PageView', Object.assign(
            { event_url: location.href,
              traffic_source: getTrafficSource() || document.referrer || '' },
            getTimeFields(eventTime),
            payload.custom_data
          ), eventId, false);
        }
      }, 50); // Aumento leve para garantir init do fbq stub

      if (cfg.gaMeasurementId) {
        loadGa(cfg.gaMeasurementId);
        trackGa('page_view', { page_location: location.href, page_title: document.title, page_path: location.pathname });
      }
    } catch(e) {
      console.error('[TRK] PageView error', e);
    }
  }

  // ─── PageEngagement ───────────────────────────────────────────────────────
  function pageEngagement() {
    try {
      var cfg = window.TRACKING_CONFIG;
      if (!cfg || !cfg.apiUrl || !cfg.siteKey) return;

      if (!pageEngagementEventId) pageEngagementEventId = genEventId();
      var eventTime = Math.floor(Date.now() / 1000);
      var eventId   = pageEngagementEventId;
      var attrs     = getAttributionParams();
      var telemetry = buildTelemetry();

      var userData  = buildUserData();
      var payload = {
        event_name:       'PageEngagement',
        event_time:       eventTime,
        event_id:         eventId,
        event_source_url: location.href,
        action_source:    'website',
        user_data:        userData,
        telemetry:        telemetry,
        custom_data:      Object.assign({
          page_title:   document.title,
          page_path:    location.pathname,
          event_url:    location.href,
          page_location: location.href,
          traffic_source: getTrafficSource()
        }, attrs)
      };

      getFingerprintHash(function(fp) {
        payload.telemetry.device_fingerprint = fp;
        send(cfg.apiUrl, cfg.siteKey, payload);
      });

      if (cfg.metaPixelId) {
        // Enviaremos PageEngagement apenas via CAPI (backend) para não atrasar/falhar no beforeunload do browser
        // Meta Docs recomendam evitar web requests lentos durante o evento beforeunload
      }

      if (cfg.gaMeasurementId) {
        loadGa(cfg.gaMeasurementId);
        trackGa('page_engagement', telemetry);
      }
    } catch(_e) {}
  }

  // ─── Generic track ────────────────────────────────────────────────────────
  function track(eventName, customData) {
    try {
      var cfg = window.TRACKING_CONFIG;
      if (!cfg || !cfg.apiUrl || !cfg.siteKey) return;

      var rawCd = customData || {};
      var ruleDedupId = rawCd._taRuleId;
      var cleanCustom = Object.assign({}, rawCd);
      delete cleanCustom._taRuleId;
      delete cleanCustom.match_href_contains;
      delete cleanCustom.match_class_contains;
      delete cleanCustom.match_css;

      // ViewContent / carrinho / checkout: o Events Manager alerta ROAS sem value+currency — envia par mínimo (0 + BRL se vazio).
      // Moeda precisa ser ISO 4217 de 3 letras (ex.: MXN); "R$", números etc. viram BRL.
      if (eventName === 'ViewContent' || eventName === 'AddToCart' || eventName === 'InitiateCheckout') {
        var rawV = cleanCustom.value;
        var parsedV = rawV !== undefined && rawV !== null && String(rawV).trim() !== '' ? parseFloat(String(rawV)) : NaN;
        if (!isFinite(parsedV) || parsedV < 0) {
          cleanCustom.value = 0;
        } else {
          cleanCustom.value = parsedV;
        }
        var rawC = cleanCustom.currency;
        var curS = (rawC === undefined || rawC === null) ? '' : String(rawC).trim().toUpperCase();
        if (!curS || curS === '0' || !/^[A-Z]{3}$/.test(curS)) {
          cleanCustom.currency = 'BRL';
        } else {
          cleanCustom.currency = curS;
        }
      }

      // Dedup por evento; regras (URL/botão) usam chave por id da regra para não matar outro CTA com o mesmo event_name
      var evKey = eventName;
      if (ruleDedupId != null && ruleDedupId !== '') {
        evKey = eventName + ':rule:' + ruleDedupId;
      }
      var nowMs = Date.now();
      if (_lastRuleFire[evKey] && (nowMs - _lastRuleFire[evKey]) < RULE_DEDUP_MS) {
        console.log('[TRK] Dedup skip: ' + evKey + ' fired ' + (nowMs - _lastRuleFire[evKey]) + 'ms ago');
        return;
      }

      _lastRuleFire[evKey] = nowMs;

      var eventTime = Math.floor(Date.now() / 1000);
      var eventId   = (cleanCustom && cleanCustom.event_id) ? cleanCustom.event_id : genEventId();
      var attrs     = getAttributionParams();
      var userData  = buildUserData();
      var baseCustom = {
        page_title:       document.title,
        page_path:        location.pathname,
        event_url:        location.href,
        page_location:    location.href,
        traffic_source:   getTrafficSource()
      };
      var telemetry = buildTelemetry({ page_path: location.pathname, page_title: document.title });

      var payload = {
        event_name:       eventName,
        event_time:       eventTime,
        event_id:         eventId,
        event_source_url: location.href,
        action_source:    'website',
        user_data:        userData,
        custom_data:      Object.assign({}, baseCustom, attrs, cleanCustom),
        telemetry:        telemetry
      };

      var isInstant = (eventName === 'InitiateCheckout' || eventName === 'AddToCart' || eventName === 'Purchase');
      if (isInstant) {
        send(cfg.apiUrl, cfg.siteKey, payload, true);
      } else {
        getFingerprintHash(function(fp) {
          payload.telemetry.device_fingerprint = fp;
          send(cfg.apiUrl, cfg.siteKey, payload);
        });
      }

      if (cfg.metaPixelId) {
        loadMetaPixel(cfg.metaPixelId);
      }
      if (cfg.metaPixelId || hasFbq()) {
        var isCustom = STANDARD_EVENTS.indexOf(eventName) < 0;
        var metaParams = Object.assign(
          {
            event_url:   location.href,
            page_title:  document.title
          },
          getTimeFields(eventTime),
          payload.custom_data
        );

        // Ensure value/currency are top-level for standard events like Purchase
        if (payload.custom_data && payload.custom_data.value !== undefined) {
          metaParams.value = payload.custom_data.value;
        }
        if (payload.custom_data && payload.custom_data.currency !== undefined) {
          metaParams.currency = payload.custom_data.currency;
        }

        if (window.fbq) {
          trackMeta(eventName, metaParams, eventId, isCustom);
        } else {
          // Pequena espera se fbq ainda não estiver pronto (script async)
          setTimeout(function() { 
            if (window.fbq) trackMeta(eventName, metaParams, eventId, isCustom);
          }, 100);
        }
      }

      if (cfg.gaMeasurementId) {
        loadGa(cfg.gaMeasurementId);
        trackGa(eventName, cleanCustom);
      }
    } catch(_e) {}
  }

  // ─── URL rule engine (SPA support) ───────────────────────────────────────
  function checkUrlRules() {
    try {
      var cfg = window.TRACKING_CONFIG;
      if (!cfg || !cfg.eventRules || !cfg.eventRules.length) return;
      
      var currentPath = location.pathname + location.search;
      // Normalização simples
      currentPath = currentPath.toLowerCase();

      // Evita loop infinito se a regra for muito genérica, mas permite re-check em navegação
      // if (currentPath === lastPath) return; 
      // lastPath = currentPath;

      for (var i = 0; i < cfg.eventRules.length; i++) {
        var rule = cfg.eventRules[i];
        if (!rule) continue;
        
        var matchVal = (rule.match_value || '').toLowerCase();
        var isMatch = false;
        
        var fullUrl = location.href.toLowerCase();

        if (rule.rule_type === 'url_contains') {
          // Legado: "contém /" casava com toda URL; tratamos só "/" como página inicial.
          if (matchVal === '/') {
            try {
              var pnx = (location.pathname || '').toLowerCase();
              if (pnx.length > 1 && pnx.slice(-1) === '/') pnx = pnx.slice(0, -1);
              isMatch = pnx === '' || pnx === '/';
            } catch (_px) { isMatch = false; }
          } else if (currentPath.indexOf(matchVal) >= 0 || fullUrl.indexOf(matchVal) >= 0) {
            isMatch = true;
          }
        }
        else if (rule.rule_type === 'url_equals' && (currentPath === matchVal || fullUrl === matchVal)) {
          isMatch = true;
        }
        else if (rule.rule_type === 'path_is_root') {
          try {
            var pn = (location.pathname || '').toLowerCase();
            if (pn.length > 1 && pn.slice(-1) === '/') pn = pn.slice(0, -1);
            isMatch = pn === '' || pn === '/';
          } catch (_pr) { isMatch = false; }
        }

        if (isMatch) {
          var customData = Object.assign({}, rule.parameters || {}, { _taRuleId: rule.id });
          track(rule.event_name, customData);
        }
      }
    } catch(_e) { console.error('[TRK] UrlRules error', _e); }
  }

  // ─── Button rule engine ──────────────────────────────────────────────────
  // Normaliza texto para matching resiliente:
  // - lower case
  // - remove acentos/diacríticos (NFD)
  // - remove pontuação comum (ex.: ¡ ¿)
  // - colapsa espaços
  function normRuleText(s) {
    try {
      if (s == null) return '';
      var t = String(s).trim().toLowerCase();
      if (!t) return '';
      if (t.normalize) {
        // Remove diacríticos (ex.: á → a, ñ → n)
        t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      }
      // Remove pontuação que costuma variar (mantém letras/números/espaços)
      t = t.replace(/[¡¿]/g, ' ');
      t = t.replace(/[^\p{L}\p{N}\s]/gu, ' ');
      t = t.replace(/\s+/g, ' ').trim();
      return t;
    } catch (_e) {
      return '';
    }
  }

  // Igual ao normRuleText, mas trata percentuais dinâmicos (A/B: 75% vs 0%) como equivalentes
  function normButtonMatchText(s) {
    var t = normRuleText(s);
    if (!t) return '';
    try {
      t = t.replace(/\b\d+\s*%/g, '%');
      t = t.replace(/\s+/g, ' ').trim();
    } catch (_e2) {}
    return t;
  }

  function findClickableRoot(fromEl) {
    var el = fromEl;
    while (el && el.nodeType === 1) {
      var tag = (el.tagName || '').toUpperCase();
      if (tag === 'A' && el.getAttribute && el.getAttribute('href')) return el;
      if (tag === 'BUTTON') return el;
      if (tag === 'INPUT') {
        var it = ((el.type || '') + '').toLowerCase();
        if (it === 'submit' || it === 'button' || it === 'image') return el;
      }
      var role = el.getAttribute && el.getAttribute('role');
      if (role === 'button') return el;
      if (tag === 'BODY' || tag === 'HTML') break;
      el = el.parentElement;
    }
    return null;
  }

  function checkButtonRules(target) {
    try {
      var cfg = window.TRACKING_CONFIG;
      if (!cfg || !cfg.eventRules || !cfg.eventRules.length) return;
      if (!target) return;

      var currentPath = (location.pathname + location.search).toLowerCase();
      var fullUrl = location.href.toLowerCase();

      var el = findClickableRoot(target);
      if (!el) return;

      var clickedText = (el.innerText || el.textContent || el.value || '').toString().trim();
      if (!clickedText && el.getAttribute) clickedText = (el.getAttribute('title') || el.getAttribute('aria-label') || '').toString().trim();
      if (!clickedText) {
        var img = el.querySelector && el.querySelector('img');
        if (img) clickedText = (img.getAttribute('alt') || img.getAttribute('title') || img.getAttribute('src') || '').toString().trim();
      }

      var clickedNorm = clickedText ? normButtonMatchText(clickedText) : '';

      var hrefNorm = '';
      if (el.tagName && el.tagName.toUpperCase() === 'A' && el.href) {
        try {
          hrefNorm = new URL(el.href, location.href).href.toLowerCase();
        } catch (_u) {
          hrefNorm = String(el.href).toLowerCase();
        }
      }

      var clsNorm = ((el.className && el.className.toString) ? el.className.toString() : String(el.className || '')).toLowerCase();

      for (var i = 0; i < cfg.eventRules.length; i++) {
        var rule = cfg.eventRules[i];
        if (rule.rule_type !== 'button_click') continue;

        var ruleUrl = (rule.match_value || '').toLowerCase().trim();
        // Regra especial: "/" significa "só Home" (pathname raiz).
        // Antes, "/" casava com todas as rotas (porque toda URL tem "/").
        if (ruleUrl === '/') {
          var pnRoot = (location.pathname || '/').toLowerCase();
          if (pnRoot !== '/' && pnRoot !== '') continue;
        } else {
          if (!ruleUrl) continue;
          if (!(currentPath.indexOf(ruleUrl) >= 0 || fullUrl.indexOf(ruleUrl) >= 0)) continue;
        }

        var params = (rule.parameters && typeof rule.parameters === 'object') ? rule.parameters : {};
        var hrefNeed = (params.match_href_contains != null ? String(params.match_href_contains) : '').trim().toLowerCase();
        var classNeed = (params.match_class_contains != null ? String(params.match_class_contains) : '').trim().toLowerCase();
        var cssSel = (params.match_css != null ? String(params.match_css) : '').trim();

        var rawRuleText = (rule.match_text != null ? String(rule.match_text) : '').trim();
        var textActive = rawRuleText.length > 0;
        var ruleTextNorm = textActive ? normButtonMatchText(rawRuleText) : '';

        var textMatch = !!(textActive && clickedNorm && ruleTextNorm && clickedNorm.indexOf(ruleTextNorm) >= 0);
        var hrefMatch = !!(hrefNeed && hrefNorm && hrefNorm.indexOf(hrefNeed) >= 0);
        var classMatch = !!(classNeed && clsNorm && clsNorm.indexOf(classNeed) >= 0);
        var cssMatch = false;
        if (cssSel) {
          try {
            if (target && target.closest) cssMatch = !!target.closest(cssSel);
            if (!cssMatch && el && el.closest) cssMatch = !!el.closest(cssSel);
          } catch (_c) {
            cssMatch = false;
          }
        }

        var altActive = !!(hrefNeed || classNeed || cssSel);
        if (!textActive && !altActive) continue;

        // Critérios preenchidos no painel são combinados com E — evita falso positivo
        // (ex.: texto + href só com hostname, que batia em todos os links do domínio).
        // Em <button> / input não há href: não exigimos href se houver texto/classe/CSS (só href vira obrigatório em <a>).
        var matched = true;
        if (textActive) matched = matched && textMatch;
        if (hrefNeed) {
          if (hrefNorm) matched = matched && hrefMatch;
          else if (!(textActive || classNeed || cssSel)) matched = false;
        }
        if (classNeed) matched = matched && classMatch;
        if (cssSel) matched = matched && cssMatch;

        if (matched) {
          var customData = Object.assign({}, params, { _taRuleId: rule.id });
          track(rule.event_name, customData);
        }
      }
    } catch (_e) {
      console.error('[TRK] BtnRules error', _e);
    }
  }

  // ─── History patch (SPA) ──────────────────────────────────────────────────
  try {
    var _pushState    = history.pushState;
    var _replaceState = history.replaceState;
    history.pushState = function() {
      pageEngagement();
      pageEngagementEventId = null;
      startMs = Date.now();
      visibleMs = 0;
      maxScroll = 0;
      totalClicks = 0;
      ctaClicks = 0;
      _pushState.apply(history, arguments);
      setTimeout(function() { pageView(); checkUrlRules(); }, 0);
    };
    history.replaceState = function() {
      pageEngagement();
      pageEngagementEventId = null;
      startMs = Date.now();
      visibleMs = 0;
      maxScroll = 0;
      totalClicks = 0;
      ctaClicks = 0;
      _replaceState.apply(history, arguments);
      setTimeout(function() { pageView(); checkUrlRules(); }, 0);
    };
    window.addEventListener('popstate', function() {
      pageEngagementEventId = null;
      startMs = Date.now();
      visibleMs = 0;
      maxScroll = 0;
      totalClicks = 0;
      ctaClicks = 0;
      setTimeout(function() { pageView(); checkUrlRules(); }, 0);
    });
    window.addEventListener('hashchange', function() {
      setTimeout(checkUrlRules, 0);
    });
  } catch(_e) {}

  // ─── Expose public API ────────────────────────────────────────────────────
  try {
    window.taIdentify = function(obj) {
      try {
        applyIdentify(obj);
        window.__TA_IDENTIFY = Object.assign(window.__TA_IDENTIFY || {}, obj || {});
        refreshMetaFbqAdvancedMatching();
      } catch(_e) {}
    };

    if (window.TA_IDENTIFY) window.taIdentify(window.TA_IDENTIFY);

    window.taDecorateUrl = function(targetUrl) {
      try {
        if (!targetUrl) return targetUrl;
        var url = new URL(targetUrl, location.href);
        var fbp = getFbp();
        var fbc = getFbc();
        var eid = getOrCreateExternalId();
        mergeCheckoutAttributionQueryParams(url, eid, fbc, fbp);
        return url.toString();
      } catch(_e) {
        return targetUrl;
      }
    };

    window.tracker = { 
      identify: window.taIdentify, 
      track: track,
      decorateUrl: window.taDecorateUrl 
    };
  } catch(_e) {}

  // ─── Auto-Tagging Checkout Links ──────────────────────────────────────────
  // UTMs + fbp/fbc/external_id na query; sck com trk_ respeitando hotmartSckMaxChars (env HOTMART_SCK_MAX_CHARS).
  function decorateCheckoutLinks() {
    var eid = getOrCreateExternalId();
    var fbc = getFbc() || '';
    var fbp = getFbp() || '';
    var cfg = window.TRACKING_CONFIG || {};
    var sckMax = cfg.hotmartSckMaxChars;
    if (sckMax === 0) sckMax = null;
    var defaultTrk = buildHotmartTrkToken(eid, fbc, fbp, sckMax);

    var checkoutDomains = [
      'pay.hotmart.com', 'hotmart.com/product', 'go.hotmart.com',
      'pay.kiwify.com.br', 'kiwify.com.br',
      'sun.eduzz.com', 'orbitpages.com',
      'checkout.perfectpay.com.br', 'perfectpay.com.br',
      'checkout.monetizze.com.br', 'monetizze.com.br',
      'checkout.ticto.com.br', 'ticto.com.br',
      'checkout.braip.com', 'braip.com',
      'pay.kirvano.com', 'kirvano.com',
      'pay.yampi.com.br', 'seguro.yampi.com.br'
    ];

    function processLink(link) {
      if (!link.href) return;
      try {
        var url = new URL(link.href);
        var isCheckout = false;
        for (var d = 0; d < checkoutDomains.length; d++) {
          if (url.href.indexOf(checkoutDomains[d]) > -1) {
            isCheckout = true; break;
          }
        }

        if (isCheckout) {
          mergeCheckoutAttributionQueryParams(url, eid, fbc, fbp);

          var hasSck = url.searchParams.has('sck');
          var hasSrc = url.searchParams.has('src');

          if (!hasSck && !hasSrc) {
            var paramName = url.hostname.indexOf('hotmart') > -1 ? 'sck' : 'src';
            if (defaultTrk) url.searchParams.set(paramName, defaultTrk);
          } else {
            var existingParam = hasSck ? 'sck' : 'src';
            var existingVal = url.searchParams.get(existingParam) || '';
            if (existingVal && existingVal.indexOf('trk_') === -1 && defaultTrk) {
              var budget = sckMax ? sckMax - existingVal.length - 1 : null;
              var tok = buildHotmartTrkToken(eid, fbc, fbp, budget && budget > 8 ? budget : null);
              if (tok) url.searchParams.set(existingParam, existingVal + '-' + tok);
            }
          }
          link.href = url.toString();
        }
      } catch (e) {}
    }

    var links = document.getElementsByTagName('a');
    for (var i = 0; i < links.length; i++) processLink(links[i]);

    if (window.MutationObserver) {
      new MutationObserver(function(mutations) {
        for (var m = 0; m < mutations.length; m++) {
          if (!mutations[m].addedNodes) continue;
          for (var n = 0; n < mutations[m].addedNodes.length; n++) {
            var node = mutations[m].addedNodes[n];
            if (node.nodeName === 'A') processLink(node);
            else if (node.getElementsByTagName) {
              var newLinks = node.getElementsByTagName('a');
              for (var j = 0; j < newLinks.length; j++) processLink(newLinks[j]);
            }
          }
        }
      }).observe(document.body, { childList: true, subtree: true });
    }
  }

  // ─── VSL Retention Observer ──────────────────────────────────────────────
  function observeVSL() {
    try {
      // Skip if already tracking a video
      if (vslState.found) return;

      function attachVideoListeners(video) {
        if (!video || vslState.found) return;
        // Wait until metadata is loaded to get duration
        function onReady() {
          if (!video.duration || !isFinite(video.duration) || video.duration < 5) return;
          vslState.found = true;
          vslState.duration = video.duration;
          vslState.videoElement = video;
          console.log('[TRK] VSL detected: ' + Math.round(video.duration) + 's');
        }

        if (video.readyState >= 1 && video.duration > 0) {
          onReady();
        } else {
          video.addEventListener('loadedmetadata', onReady);
        }

        video.addEventListener('timeupdate', function() {
          if (!vslState.found || !vslState.duration) return;
          vslState.currentTime = video.currentTime;
          var pct = (video.currentTime / vslState.duration) * 100;
          if (pct > vslState.maxPct) vslState.maxPct = pct;

          var thresholds = [25, 50, 75, 100];
          for (var t = 0; t < thresholds.length; t++) {
            var milestone = thresholds[t];
            if (pct >= milestone && !vslState.milestones[milestone]) {
              vslState.milestones[milestone] = true;
              console.log('[TRK] VSL milestone: ' + milestone + '%');
              track('VideoMilestone', {
                milestone: milestone,
                video_duration_s: Math.round(vslState.duration),
                current_time_s: Math.round(video.currentTime),
                page_path: location.pathname
              });
            }
          }
        });

        video.addEventListener('ended', function() {
          if (!vslState.found) return;
          vslState.maxPct = 100;
          if (!vslState.milestones[100]) {
            vslState.milestones[100] = true;
            console.log('[TRK] VSL milestone: 100% (ended)');
            track('VideoMilestone', {
              milestone: 100,
              video_duration_s: Math.round(vslState.duration),
              current_time_s: Math.round(vslState.duration),
              page_path: location.pathname
            });
          }
        });
      }

      // Scan existing <video> elements
      var videos = document.querySelectorAll('video');
      for (var i = 0; i < videos.length; i++) {
        attachVideoListeners(videos[i]);
        if (vslState.found) break;
      }

      // Watch for dynamically added videos (SPAs, lazy-load players)
      if (window.MutationObserver && !vslState.found) {
        var vslObserver = new MutationObserver(function(mutations) {
          if (vslState.found) return;
          for (var m = 0; m < mutations.length; m++) {
            if (!mutations[m].addedNodes) continue;
            for (var n = 0; n < mutations[m].addedNodes.length; n++) {
              var node = mutations[m].addedNodes[n];
              if (node.nodeName === 'VIDEO') {
                attachVideoListeners(node);
              } else if (node.querySelectorAll) {
                var innerVideos = node.querySelectorAll('video');
                for (var j = 0; j < innerVideos.length; j++) {
                  attachVideoListeners(innerVideos[j]);
                  if (vslState.found) break;
                }
              }
              if (vslState.found) { vslObserver.disconnect(); return; }
            }
          }
        });
        vslObserver.observe(document.body, { childList: true, subtree: true });
      }
    } catch(_e) { console.error('[TRK] VSL observer error', _e); }
  }

  // ─── Init ─────────────────────────────────────────────────────────────────
  function getPickerConfig() {
    try {
      var qs = new URLSearchParams(location.search || '');
      if (qs.get('ta_pick') !== '1') return null;
      var origin = qs.get('ta_origin') || '';
      origin = origin.trim();
      if (!origin) return null;
      // Basic sanity: require http(s)
      if (origin.indexOf('http://') !== 0 && origin.indexOf('https://') !== 0) return null;
      return { origin: origin };
    } catch (_e) {
      return null;
    }
  }

  function getTestConfig() {
    try {
      var qs = new URLSearchParams(location.search || '');
      if (qs.get('ta_test') !== '1') return null;
      var origin = qs.get('ta_origin') || '';
      origin = origin.trim();
      if (!origin) return null;
      if (origin.indexOf('http://') !== 0 && origin.indexOf('https://') !== 0) return null;
      var ruleB64 = qs.get('ta_rule') || '';
      ruleB64 = ruleB64.trim();
      if (!ruleB64) return null;

      // Decode base64 utf-8
      var jsonStr = '';
      try {
        jsonStr = decodeURIComponent(escape(atob(ruleB64)));
      } catch (_e1) {
        try { jsonStr = atob(ruleB64); } catch (_e2) { jsonStr = ''; }
      }
      if (!jsonStr) return null;
      var obj = null;
      try { obj = JSON.parse(jsonStr); } catch (_e3) { obj = null; }
      if (!obj || typeof obj !== 'object') return null;

      return { origin: origin, rule: obj };
    } catch (_e) {
      return null;
    }
  }

  function cssEscapeSimple(s) {
    try {
      // Minimal escaping for common ID/class chars
      return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&');
    } catch (_e) {
      return '';
    }
  }

  function buildCssSelector(el) {
    try {
      if (!el || !el.tagName) return '';
      // Prefer stable IDs
      var id = el.getAttribute && el.getAttribute('id');
      if (id && String(id).trim()) return '#' + cssEscapeSimple(String(id).trim());

      var tag = String(el.tagName).toLowerCase();
      var cls = ((el.className && el.className.toString) ? el.className.toString() : String(el.className || '')).trim();
      if (cls) {
        var parts = cls.split(/\s+/).filter(Boolean).slice(0, 3);
        if (parts.length) return tag + '.' + parts.map(cssEscapeSimple).join('.');
      }

      // Fallback: tag + nth-of-type chain up to 3 levels
      var path = [];
      var cur = el;
      for (var depth = 0; depth < 3 && cur && cur.tagName && cur.parentElement; depth++) {
        var t = String(cur.tagName).toLowerCase();
        var idx = 1;
        var sib = cur;
        while (sib && (sib = sib.previousElementSibling)) {
          if (sib.tagName === cur.tagName) idx++;
        }
        path.unshift(t + ':nth-of-type(' + idx + ')');
        cur = cur.parentElement;
        if (cur && (String(cur.tagName).toUpperCase() === 'BODY' || String(cur.tagName).toUpperCase() === 'HTML')) break;
      }
      return path.join(' > ');
    } catch (_e) {
      return '';
    }
  }

  /** Path (+ query útil) para regra "URL contém": sem parâmetros internos do Trajettu. */
  function pagePathForButtonRule() {
    try {
      var path = location.pathname || '';
      var q = location.search || '';
      if (!q) return path;
      var raw = q.charAt(0) === '?' ? q.slice(1) : q;
      var u = new URLSearchParams(raw);
      var strip = ['ta_pick', 'ta_origin', 'ta_test', 'ta_rule'];
      for (var si = 0; si < strip.length; si++) u.delete(strip[si]);
      var s = u.toString();
      return s ? path + '?' + s : path;
    } catch (_e) {
      return location.pathname || '';
    }
  }

  /** Atualiza a barra de endereços para a URL "limpa" (sem ta_pick / ta_origin etc.), sem recarregar. */
  function replaceBarUrlRemovingTrajettuAux() {
    try {
      if (!history || !history.replaceState) return;
      var clean = pagePathForButtonRule();
      var hash = location.hash || '';
      history.replaceState(null, '', clean + hash);
    } catch (_e) {}
  }

  function initPicker(cfg) {
    try {
      replaceBarUrlRemovingTrajettuAux();
      // Lightweight overlay UI
      var overlay = document.createElement('div');
      overlay.id = '__ta_picker_overlay';
      overlay.style.cssText =
        'position:fixed;inset:0;z-index:2147483647;pointer-events:none;' +
        'background:rgba(0,0,0,0.03);';

      var tip = document.createElement('div');
      tip.style.cssText =
        'position:fixed;left:12px;bottom:12px;z-index:2147483647;' +
        'max-width:520px;padding:10px 12px;border-radius:10px;' +
        'background:rgba(24,24,27,0.94);color:#fff;font:12px/1.4 system-ui,Segoe UI,Arial;' +
        'box-shadow:0 10px 30px rgba(0,0,0,0.25);pointer-events:auto;';
      tip.innerHTML =
        '<div style="font-weight:700;margin-bottom:4px">Seleção Trajettu</div>' +
        '<div style="opacity:.9">Clique no botão/CTA. Os dados voltam ao painel e esta janela pode fechar. <b>Esc</b> cancela.</div>';

      var hl = document.createElement('div');
      hl.style.cssText =
        'position:fixed;z-index:2147483647;border:2px solid #22c55e;border-radius:10px;' +
        'box-shadow:0 0 0 2px rgba(34,197,94,0.25);pointer-events:none;display:none;';

      document.documentElement.appendChild(overlay);
      document.documentElement.appendChild(hl);
      document.documentElement.appendChild(tip);

      function cleanup() {
        try { overlay.remove(); } catch (_e1) {}
        try { hl.remove(); } catch (_e2) {}
        try { tip.remove(); } catch (_e3) {}
        try { document.removeEventListener('mousemove', onMove, true); } catch (_e4) {}
        try { document.removeEventListener('click', onPick, true); } catch (_e5) {}
        try { document.removeEventListener('keydown', onKey, true); } catch (_e6) {}
      }

      function onKey(e) {
        if (!e) return;
        if (e.key === 'Escape') {
          cleanup();
        }
      }

      function onMove(e) {
        try {
          var t = e && e.target ? findClickableRoot(e.target) : null;
          if (!t || !t.getBoundingClientRect) { hl.style.display = 'none'; return; }
          var r = t.getBoundingClientRect();
          hl.style.display = 'block';
          hl.style.left = Math.max(0, r.left - 2) + 'px';
          hl.style.top = Math.max(0, r.top - 2) + 'px';
          hl.style.width = Math.max(0, r.width + 4) + 'px';
          hl.style.height = Math.max(0, r.height + 4) + 'px';
        } catch (_e) {
          hl.style.display = 'none';
        }
      }

      function onPick(e) {
        try {
          if (!e) return;
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();

          var root = findClickableRoot(e.target);
          if (!root) return;

          var text = (root.innerText || root.textContent || root.value || '').toString().trim();
          if (!text && root.getAttribute) text = (root.getAttribute('title') || root.getAttribute('aria-label') || '').toString().trim();

          var hrefNorm = '';
          if (root.tagName && root.tagName.toUpperCase() === 'A' && root.href) {
            try { hrefNorm = new URL(root.href, location.href).href; } catch (_u) { hrefNorm = String(root.href); }
          }
          var cls = ((root.className && root.className.toString) ? root.className.toString() : String(root.className || '')).trim();
          var firstClass = '';
          if (cls) firstClass = cls.split(/\s+/).filter(Boolean)[0] || '';

          var payload = {
            page_path: pagePathForButtonRule(),
            text: text,
            href: hrefNorm,
            class_list: cls,
            suggested: {
              match_text: text ? text.slice(0, 200) : '',
              match_href_contains: (function(){
                if (!hrefNorm) return '';
                try {
                  var u = new URL(hrefNorm, location.href);
                  var pathQ = (u.pathname + u.search).toLowerCase();
                  if (pathQ && pathQ !== '/') return pathQ.length > 240 ? pathQ.slice(0, 240) : pathQ;
                  return (u.hostname || '').toLowerCase();
                } catch(_eH) { return ''; }
              })(),
              match_class_contains: firstClass,
              match_css: buildCssSelector(root),
            }
          };

          try {
            if (window.opener && window.opener.postMessage) {
              window.opener.postMessage({ type: 'TA_BUTTON_PICK', payload: payload }, cfg.origin);
            }
          } catch (_pm) {}

          cleanup();
        } catch (_e) {}
      }

      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('click', onPick, true);
      document.addEventListener('keydown', onKey, true);
    } catch (_e) {}
  }

  function initTestMode(cfg) {
    try {
      replaceBarUrlRemovingTrajettuAux();
      var rule = cfg.rule || {};
      var ruleText = (rule.match_text != null ? String(rule.match_text) : '').trim();
      var hrefNeed = (rule.match_href_contains != null ? String(rule.match_href_contains) : '').trim().toLowerCase();
      var classNeed = (rule.match_class_contains != null ? String(rule.match_class_contains) : '').trim().toLowerCase();
      var cssSel = (rule.match_css != null ? String(rule.match_css) : '').trim();

      var textActive = !!ruleText;
      var altActive = !!(hrefNeed || classNeed || cssSel);
      if (!textActive && !altActive) {
        console.warn('[TRK] Test mode: no match criteria provided.');
      }

      var overlay = document.createElement('div');
      overlay.id = '__ta_test_overlay';
      overlay.style.cssText =
        'position:fixed;inset:0;z-index:2147483647;pointer-events:none;' +
        'background:rgba(0,0,0,0.03);';

      var tip = document.createElement('div');
      tip.style.cssText =
        'position:fixed;left:12px;bottom:12px;z-index:2147483647;' +
        'max-width:560px;padding:10px 12px;border-radius:10px;' +
        'background:rgba(24,24,27,0.94);color:#fff;font:12px/1.4 system-ui,Segoe UI,Arial;' +
        'box-shadow:0 10px 30px rgba(0,0,0,0.25);pointer-events:auto;';
      tip.innerHTML =
        '<div style="font-weight:700;margin-bottom:4px">Teste de Regra Trajettu</div>' +
        '<div style="opacity:.9">' +
        (!textActive && !altActive
          ? 'Nenhum critério foi enviado do painel — ao clicar, mostramos só <b>sugestões</b> para você copiar. Defina texto/classe/href/CSS no Trajettu e teste de novo.'
          : 'Clique no botão/CTA para validar a regra. Aperte <b>Esc</b> para sair.') +
        '</div>';

      var resultBox = document.createElement('div');
      resultBox.style.cssText =
        'position:fixed;right:12px;bottom:12px;z-index:2147483647;' +
        'max-width:560px;padding:10px 12px;border-radius:10px;' +
        'background:rgba(24,24,27,0.94);color:#fff;font:12px/1.45 system-ui,Segoe UI,Arial;' +
        'box-shadow:0 10px 30px rgba(0,0,0,0.25);pointer-events:auto;display:none;';

      var hl = document.createElement('div');
      hl.style.cssText =
        'position:fixed;z-index:2147483647;border:2px solid #3b82f6;border-radius:10px;' +
        'box-shadow:0 0 0 2px rgba(59,130,246,0.25);pointer-events:none;display:none;';

      document.documentElement.appendChild(overlay);
      document.documentElement.appendChild(hl);
      document.documentElement.appendChild(tip);
      document.documentElement.appendChild(resultBox);

      function cleanup() {
        try { overlay.remove(); } catch (_e1) {}
        try { hl.remove(); } catch (_e2) {}
        try { tip.remove(); } catch (_e3) {}
        try { resultBox.remove(); } catch (_e4) {}
        try { document.removeEventListener('mousemove', onMove, true); } catch (_e5) {}
        try { document.removeEventListener('click', onClick, true); } catch (_e6) {}
        try { document.removeEventListener('keydown', onKey, true); } catch (_e7) {}
      }

      function onKey(e) {
        if (!e) return;
        if (e.key === 'Escape') cleanup();
      }

      function onMove(e) {
        try {
          var t = e && e.target ? findClickableRoot(e.target) : null;
          if (!t || !t.getBoundingClientRect) { hl.style.display = 'none'; return; }
          var r = t.getBoundingClientRect();
          hl.style.display = 'block';
          hl.style.left = Math.max(0, r.left - 2) + 'px';
          hl.style.top = Math.max(0, r.top - 2) + 'px';
          hl.style.width = Math.max(0, r.width + 4) + 'px';
          hl.style.height = Math.max(0, r.height + 4) + 'px';
        } catch (_e) {
          hl.style.display = 'none';
        }
      }

      function safeNormText(s) {
        try { return normButtonMatchText(s); } catch (_e) { return ''; }
      }

      function onClick(e) {
        try {
          if (!e) return;
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();

          var root = findClickableRoot(e.target);
          if (!root) return;

          var clickedText = (root.innerText || root.textContent || root.value || '').toString().trim();
          if (!clickedText && root.getAttribute) clickedText = (root.getAttribute('title') || root.getAttribute('aria-label') || '').toString().trim();
          var clickedNorm = clickedText ? safeNormText(clickedText) : '';
          var ruleNorm = ruleText ? safeNormText(ruleText) : '';

          var hrefNorm = '';
          if (root.tagName && root.tagName.toUpperCase() === 'A' && root.href) {
            try { hrefNorm = new URL(root.href, location.href).href.toLowerCase(); } catch (_u) { hrefNorm = String(root.href).toLowerCase(); }
          }
          var clsNorm = ((root.className && root.className.toString) ? root.className.toString() : String(root.className || '')).toLowerCase();

          var textMatch = !!(textActive && clickedNorm && ruleNorm && clickedNorm.indexOf(ruleNorm) >= 0);
          var hrefMatch = !!(hrefNeed && hrefNorm && hrefNorm.indexOf(hrefNeed) >= 0);
          var classMatch = !!(classNeed && clsNorm && clsNorm.indexOf(classNeed) >= 0);
          var cssMatch = false;
          if (cssSel) {
            try {
              if (e.target && e.target.closest) cssMatch = !!e.target.closest(cssSel);
              if (!cssMatch && root && root.closest) cssMatch = !!root.closest(cssSel);
            } catch (_c) {
              cssMatch = false;
            }
          }

          var matched = true;
          if (textActive) matched = matched && textMatch;
          if (hrefNeed) {
            if (hrefNorm) matched = matched && hrefMatch;
            else if (!(textActive || classNeed || cssSel)) matched = false;
          }
          if (classNeed) matched = matched && classMatch;
          if (cssSel) matched = matched && cssMatch;

          var noCriteria = !textActive && !hrefNeed && !classNeed && !cssSel;
          var firstClass = '';
          if (clsNorm) {
            var cparts = clsNorm.split(/\s+/).filter(Boolean);
            firstClass = cparts.length ? cparts[0] : '';
          }
          var sugCss = buildCssSelector(root);
          var sugText = clickedText ? clickedText.slice(0, 200) : '';

          var lines = [];
          if (noCriteria) {
            lines.push('<div style="font-weight:700;margin-bottom:6px;color:#fbbf24">Diagnóstico (sem critérios no painel)</div>');
            lines.push('<div style="opacity:.88;margin-bottom:8px">O teste <b>não falhou</b> por causa do botão: você ainda não enviou texto/href/classe/CSS do Trajettu. Copie as sugestões abaixo e clique em <b>Testar regra</b> de novo.</div>');
            lines.push('<div style="opacity:.85;margin-bottom:6px">Clique capturado:</div>');
            lines.push('<div style="font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size:11px; opacity:.95">texto: ' + (clickedText ? clickedText.replace(/</g,'&lt;') : '—') + '</div>');
            lines.push('<div style="font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size:11px; opacity:.95">href: ' + (hrefNorm ? hrefNorm.replace(/</g,'&lt;') : '— (normal em &lt;button&gt;, não é link)') + '</div>');
            lines.push('<div style="font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size:11px; opacity:.95">classe: ' + (clsNorm ? clsNorm.replace(/</g,'&lt;') : '—') + '</div>');
            lines.push('<hr style="border:none;border-top:1px solid rgba(255,255,255,0.12);margin:10px 0">');
            lines.push('<div style="opacity:.9;margin-bottom:6px">Sugestões para colar no Trajettu:</div>');
            lines.push('<div style="font-size:11px;margin-bottom:4px"><b>Classe CSS contém:</b> ' + (firstClass ? firstClass.replace(/</g,'&lt;') : '—') + '</div>');
            lines.push('<div style="font-size:11px;margin-bottom:4px"><b>Seletor CSS:</b> ' + (sugCss ? sugCss.replace(/</g,'&lt;') : '—') + '</div>');
            lines.push('<div style="font-size:11px;margin-bottom:4px"><b>Texto contém (trecho):</b> ' + (sugText ? sugText.replace(/</g,'&lt;') : '—') + '</div>');
            matched = false;
          } else {
            lines.push('<div style="font-weight:700;margin-bottom:6px">' + (matched ? 'PASSOU ✅' : 'NÃO PASSOU ❌') + '</div>');
            lines.push('<div style="opacity:.9;margin-bottom:8px">Clique avaliado:</div>');
            lines.push('<div style="font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size:11px; opacity:.95">texto: ' + (clickedText ? clickedText.replace(/</g,'&lt;') : '—') + '</div>');
            lines.push('<div style="font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size:11px; opacity:.95">href: ' + (hrefNorm ? hrefNorm.replace(/</g,'&lt;') : '—') + '</div>');
            lines.push('<div style="font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size:11px; opacity:.95">classe: ' + (clsNorm ? clsNorm.replace(/</g,'&lt;') : '—') + '</div>');
            lines.push('<hr style="border:none;border-top:1px solid rgba(255,255,255,0.12);margin:10px 0">');
            lines.push('<div style="opacity:.9;margin-bottom:6px">Resultado por critério:</div>');
            if (textActive) lines.push('<div>texto: <b style="color:' + (textMatch ? '#22c55e' : '#f87171') + '">' + (textMatch ? 'ok' : 'falhou') + '</b></div>');
            if (hrefNeed) lines.push('<div>href contém "' + hrefNeed.replace(/</g,'&lt;') + '": <b style="color:' + (hrefMatch ? '#22c55e' : '#f87171') + '">' + (hrefMatch ? 'ok' : 'falhou') + '</b></div>');
            if (classNeed) lines.push('<div>classe contém "' + classNeed.replace(/</g,'&lt;') + '": <b style="color:' + (classMatch ? '#22c55e' : '#f87171') + '">' + (classMatch ? 'ok' : 'falhou') + '</b></div>');
            if (cssSel) lines.push('<div>css "' + cssSel.replace(/</g,'&lt;') + '": <b style="color:' + (cssMatch ? '#22c55e' : '#f87171') + '">' + (cssMatch ? 'ok' : 'falhou') + '</b></div>');
          }

          resultBox.style.display = 'block';
          resultBox.innerHTML = lines.join('');

          // Also notify opener (optional)
          try {
            if (window.opener && window.opener.postMessage) {
              window.opener.postMessage({
                type: 'TA_RULE_TEST_RESULT',
                payload: {
                  matched: noCriteria ? null : matched,
                  diagnosticsOnly: noCriteria,
                  suggested: noCriteria
                    ? { match_class_contains: firstClass || undefined, match_css: sugCss || undefined, match_text: sugText || undefined }
                    : undefined,
                  details: { textMatch: textMatch, hrefMatch: hrefMatch, classMatch: classMatch, cssMatch: cssMatch },
                }
              }, cfg.origin);
            }
          } catch (_pm) {}
        } catch (_e) {}
      }

      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('click', onClick, true);
      document.addEventListener('keydown', onKey, true);
    } catch (_e) {}
  }

  /** Evita o mesmo <script src="..."> duas vezes (head + snippet, ou HTML colado em duplicata). */
  function __taNormalizeScriptSrc(srcAttr) {
    try {
      if (!srcAttr || typeof srcAttr !== 'string') return '';
      return new URL(srcAttr.trim(), location.href).href;
    } catch (_u) {
      return '';
    }
  }
  function __taScriptSrcAlreadyLoaded(absUrl) {
    if (!absUrl) return false;
    try {
      var nodes = document.getElementsByTagName('script');
      var i = 0;
      for (i = 0; i < nodes.length; i++) {
        var s = nodes[i].getAttribute('src');
        if (!s) continue;
        if (__taNormalizeScriptSrc(s) === absUrl) return true;
      }
    } catch (_e) {}
    return false;
  }

  /** Injeta HTML do painel (script externo/inline, noscript, etc.) com execução correta de scripts. */
  function injectHtmlFragment(html, parent) {
    try {
      if (!html || !parent) return;
      var str = String(html).trim();
      if (!str) return;
      if (!window.__TA_INJECTED_SCRIPT_SRC) window.__TA_INJECTED_SCRIPT_SRC = {};
      var injectedSrc = window.__TA_INJECTED_SCRIPT_SRC;
      var tpl = document.createElement('template');
      tpl.innerHTML = str;
      var scripts = tpl.content.querySelectorAll('script');
      var k = 0;
      for (k = 0; k < scripts.length; k++) {
        var oldS = scripts[k];
        var srcAttr = oldS.getAttribute && oldS.getAttribute('src');
        if (srcAttr) {
          var abs = __taNormalizeScriptSrc(srcAttr);
          if (abs && (injectedSrc[abs] || __taScriptSrcAlreadyLoaded(abs))) {
            try { oldS.remove(); } catch (_rm) {}
            continue;
          }
          if (abs) injectedSrc[abs] = true;
        }
        var nu = document.createElement('script');
        var attrs = oldS.attributes;
        var ai = 0;
        for (ai = 0; ai < attrs.length; ai++) {
          nu.setAttribute(attrs[ai].name, attrs[ai].value);
        }
        nu.textContent = oldS.textContent;
        oldS.parentNode.replaceChild(nu, oldS);
      }
      while (tpl.content.firstChild) parent.appendChild(tpl.content.firstChild);
    } catch (_e) {}
  }

  function applyCustomSnippetsOnce() {
    try {
      if (window.__TA_CUSTOM_SNIPPETS_APPLIED) return;
      // Modo performance híbrido: tracker inicia (Meta + CAPI), mas snippets extras só após primeira interação.
      // loader.js seta window.__TA_DEFER_EXTRAS = true.
      try {
        if (window.__TA_DEFER_EXTRAS === true) {
          if (!window.__TA_DEFER_EXTRAS_HOOKED) {
            window.__TA_DEFER_EXTRAS_HOOKED = true;
            var onFirstExtras = function() {
              try {
                window.removeEventListener('pointerdown', onFirstExtras, true);
                window.removeEventListener('keydown', onFirstExtras, true);
                window.removeEventListener('scroll', onFirstExtras, true);
                window.removeEventListener('touchstart', onFirstExtras, true);
              } catch(_eOff) {}
              try { window.__TA_DEFER_EXTRAS = false; } catch(_eFlag) {}
              try { applyCustomSnippetsOnce(); } catch(_eApply) {}
            };
            window.addEventListener('pointerdown', onFirstExtras, true);
            window.addEventListener('keydown', onFirstExtras, true);
            window.addEventListener('scroll', onFirstExtras, { passive: true, capture: true });
            window.addEventListener('touchstart', onFirstExtras, { passive: true, capture: true });
          }
          return;
        }
      } catch(_eDefer) {}
      var cfg = window.TRACKING_CONFIG;
      if (!cfg) return;
      var h = cfg.injectHeadHtml;
      var b = cfg.injectBodyHtml;
      var list = cfg.injectSnippets;
      if (!h && !b && (!list || !list.length)) {
        window.__TA_CUSTOM_SNIPPETS_APPLIED = true;
        return;
      }
      if (h && document.head) injectHtmlFragment(h, document.head);
      if (b) {
        var bp = document.body || document.documentElement;
        injectHtmlFragment(b, bp);
      }
      try {
        if (list && list.length) {
          for (var i = 0; i < list.length; i++) {
            var it = list[i];
            if (!it) continue;
            var pos = (it.position || '').toLowerCase();
            var html = it.html || '';
            if (!html) continue;
            if (pos === 'head') {
              if (document.head) injectHtmlFragment(html, document.head);
            } else {
              var bp2 = document.body || document.documentElement;
              injectHtmlFragment(html, bp2);
            }
          }
        }
      } catch (_eList) {}
      window.__TA_CUSTOM_SNIPPETS_APPLIED = true;
    } catch (_e2) {}
  }

  function initTracker() {
    prefetchGeoForMatching();
    applyCustomSnippetsOnce();
    var pick = getPickerConfig();
    if (pick) {
      initPicker(pick);
      return;
    }
    var test = getTestConfig();
    if (test) {
      initTestMode(test);
      return;
    }
    pageView();
    checkUrlRules();
    decorateCheckoutLinks();
    observeVSL();
  }

  function bootstrap() {
    if (document.visibilityState === 'prerender') {
      // O Chrome está pré-carregando a página em background (ex: autocompleting URL).
      // Seguramos o disparo até o usuário realmente abrir a aba.
      var onVisible = function() {
        if (document.visibilityState !== 'prerender') {
          document.removeEventListener('visibilitychange', onVisible);
          initTracker();
        }
      };
      document.addEventListener('visibilitychange', onVisible);
    } else {
      initTracker();
    }
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    bootstrap();
  } else {
    document.addEventListener('DOMContentLoaded', bootstrap);
  }

  // Iniciando captura de Web Vitals de forma assíncrona
  try {
    if (window.PerformanceObserver) {
      new PerformanceObserver(function(l) {
        l.getEntries().forEach(function(e) { if (!e.hadRecentInput) webVitals.cls += e.value; });
      }).observe({ type: 'layout-shift', buffered: true });
      new PerformanceObserver(function(l) {
        var e = l.getEntries(); var last = e[e.length - 1];
        if (last) webVitals.lcp = last.renderTime || last.loadTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver(function(l) {
        var first = l.getEntries()[0];
        if (first) webVitals.fid = first.processingStart - first.startTime;
      }).observe({ type: 'first-input', buffered: true });
      new PerformanceObserver(function(l) {
        l.getEntries().forEach(function(e) { if (e.name === 'first-contentful-paint') webVitals.fcp = e.startTime; });
      }).observe({ type: 'paint', buffered: true });
    }
  } catch(_e) {}

  var _pageEngagementSent = false;
  function sendPageEngagement() {
    if (_pageEngagementSent) return;
    _pageEngagementSent = true;
    pageEngagement();
  }

  // Auto ViewContent: dispara quando o visitante demonstra engajamento real
  // (scroll > 50% E tempo > 15s). Ensina o Meta a diferenciar visitas qualificadas de bounces.
  var _autoViewContentSent = false;
  function checkAutoViewContent() {
    if (_autoViewContentSent) return;
    var dwellS = (Date.now() - startMs) / 1000;
    if (maxScroll >= 50 && dwellS >= 15) {
      _autoViewContentSent = true;
      track('ViewContent', {
        content_name: document.title,
        content_category: 'auto_engagement',
        value: 0,
        currency: 'BRL'
      });
    }
  }
  setInterval(checkAutoViewContent, 3000);

  window.addEventListener('beforeunload', sendPageEngagement);
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'hidden') pageEngagement();
  });

})();
`;

  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60'); // 1-minute global cache for fast updates without overwhelming DB
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.send(js);
});

export default router;
