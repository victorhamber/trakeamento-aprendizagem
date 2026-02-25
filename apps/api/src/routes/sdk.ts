import { Router } from 'express';
import { pool } from '../db/pool';

const router = Router();

router.get('/tracker.js', async (req, res) => {
  const siteKey = req.query.key as string;
  let configJs = '';

  if (siteKey) {
    try {
      const siteRow = await pool.query('SELECT id FROM sites WHERE site_key = $1', [siteKey]);
      if (siteRow && siteRow.rowCount && siteRow.rowCount > 0) {
        const siteId = siteRow.rows[0].id;

        const meta = await pool.query('SELECT enabled, pixel_id FROM integrations_meta WHERE site_id = $1', [siteId]);
        const ga = await pool.query('SELECT enabled, measurement_id FROM integrations_ga WHERE site_id = $1', [siteId]);

        const metaRow = meta.rows[0] as { enabled?: boolean | null; pixel_id?: string | null } | undefined;
        const gaRow = ga.rows[0] as { enabled?: boolean | null; measurement_id?: string | null } | undefined;

        const metaPixelId = metaRow && metaRow.enabled === false ? null : typeof metaRow?.pixel_id === 'string' ? metaRow.pixel_id.trim() : null;
        const gaMeasurementId = gaRow && gaRow.enabled === false ? null : typeof gaRow?.measurement_id === 'string' ? gaRow.measurement_id.trim() : null;

        const rules = await pool.query('SELECT rule_type, match_value, match_text, event_name, event_type FROM site_url_rules WHERE site_id = $1', [siteId]);
        const eventRules = rules.rows;

        const apiUrl =
          process.env.PUBLIC_API_BASE_URL ||
          process.env.API_BASE_URL ||
          `${req.headers['x-forwarded-proto'] || req.protocol}://${req.headers['x-forwarded-host'] || req.get('host')}`;

        const configObj = {
          apiUrl,
          siteKey,
          metaPixelId,
          gaMeasurementId,
          eventRules
        };

        configJs = `window.TRACKING_CONFIG = ${JSON.stringify(configObj)};\n\n`;
      } else {
        configJs = `console.warn('[TRK] Site key not found');\n\n`;
      }
    } catch (e) {
      configJs = `console.error('[TRK] Error loading smart config');\n\n`;
    }
  }

  const js = configJs + `
(function(){
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
  var pendingQueue = []; // batch queue para beforeunload
  var webVitals    = { lcp: 0, fid: 0, cls: 0, fcp: 0 };

  // ─── Cookie helpers ───────────────────────────────────────────────────────
  function getCookie(name) {
    var value = '; ' + document.cookie;
    var parts = value.split('; ' + name + '=');
    if (parts.length === 2) return parts.pop().split(';').shift();
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

  // ─── Hashed cookie helpers ────────────────────────────────────────────────
  function setHashedCookie(cookieName, rawValue, normalizer) {
    try {
      var normalized = normalizer ? normalizer(rawValue) : (rawValue || '').toString();
      if (!normalized) return;
      sha256Hex(normalized, function(hash) {
        if (hash) setCookie(cookieName, hash, COOKIE_TTL_2Y);
      });
    } catch(_e) {}
  }

  function getMetaUserDataFromCookies() {
    var out = {};
    var fields = { em:'_ta_em', ph:'_ta_ph', fn:'_ta_fn', ln:'_ta_ln',
                   ct:'_ta_ct', st:'_ta_st', zp:'_ta_zp', db:'_ta_db' };
    for (var k in fields) {
      var v = getCookie(fields[k]);
      if (v) out[k] = v;
    }
    return out;
  }

  // ─── External ID ─────────────────────────────────────────────────────────
  function getOrCreateExternalId() {
    var v = getCookie('_ta_eid');
    if (v) return v;
    var id = 'eid_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    setCookie('_ta_eid', id, COOKIE_TTL_2Y);
    return id;
  }

  // ─── FBC / FBP ───────────────────────────────────────────────────────────
  function getFbc() {
    var fbc = getCookie('_fbc');
    if (fbc) return fbc;
    try {
      var url     = new URL(location.href);
      var fbclid  = url.searchParams.get('fbclid');
      if (fbclid) {
        // Formato correto: fb.{version}.{creationTime}.{fbclid}
        var generated = 'fb.1.' + Date.now() + '.' + fbclid;
        setCookie('_fbc', generated, COOKIE_TTL_90D);
        return generated;
      }
    } catch(_e) {}
    return undefined;
  }

  function getFbp() {
    var fbp = getCookie('_fbp');
    if (fbp) return fbp;
    // Gera _fbp no formato Meta quando o Pixel não está carregado (ex: adblocker)
    // Formato: fb.{subdomainIndex}.{creationTime}.{random}
    try {
      var generated = 'fb.1.' + Date.now() + '.' + Math.floor(Math.random() * 1e10);
      setCookie('_fbp', generated, COOKIE_TTL_2Y);
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
    sha256Hex(getDeviceFingerprint(), function(h) {
      _fingerprintHash = h;
      cb(h);
    });
  }

  // ─── Attribution params ───────────────────────────────────────────────────
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
    return out;
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
  function getTimeFields(epochSec) {
    try {
      var d = new Date(epochSec * 1000);
      var days   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
      var months = ['January','February','March','April','May','June','July',
                    'August','September','October','November','December'];
      var h = d.getHours();
      return {
        event_day:           days[d.getDay()],
        event_day_in_month:  d.getDate(),
        event_month:         months[d.getMonth()],
        event_time_interval: String(h) + '-' + String(h + 1),
        event_hour:          h
      };
    } catch(_e) { return {}; }
  }

  function genEventId() {
    return 'evt_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  // ─── Page visibility (dwell real) ────────────────────────────────────────
  document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
      hiddenSince = Date.now();
    } else {
      if (hiddenSince) {
        // não conta tempo com a aba escondida
        startMs += (Date.now() - hiddenSince);
        hiddenSince = null;
      }
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
      if (fbp) url.searchParams.set('fbp', fbp);
      if (fbc) url.searchParams.set('fbc', fbc);
      if (eid) url.searchParams.set('external_id', eid);
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
    var out  = { email:'', phone:'', fn:'', ln:'', ct:'', st:'', zp:'', db:'' };
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

      var auto = autoExtractIdentify(raw);
      if (!fn && auto.fn) setHashedCookie('_ta_fn', auto.fn, normName);
      if (!ln && auto.ln) setHashedCookie('_ta_ln', auto.ln, normName);
      if (auto.ct) setHashedCookie('_ta_ct', auto.ct, normCityState);
      if (auto.st) setHashedCookie('_ta_st', auto.st, normCityState);
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
        w.fbq('init', pixelId, am);
        inits[pixelId] = true;
      }
      metaLoaded = true;
    } catch(_e) {}
  }

  function trackMeta(eventName, params, eventId, isCustom) {
    try {
      if (!window.fbq) return;
      var opts = eventId ? { eventID: eventId } : {};
      // Reinjetar advanced matching do cookie se vazio nos params
      if (params && typeof params === 'object') {
        var am = getMetaUserDataFromCookies();
        var amKeys = ['em','ph','fn','ln','ct','st','zp','db','external_id'];
        for (var i = 0; i < amKeys.length; i++) {
          var k = amKeys[i];
          if (!params[k] && am[k]) params[k] = am[k];
        }
      }
      if (isCustom) window.fbq('trackCustom', eventName, params || {}, opts);
      else          window.fbq('track', eventName, params || {}, opts);
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
    return {
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
      db:  metaUser.db
    };
  }

  function buildTelemetry(extra) {
    var dwellMs = Math.max(0, Date.now() - startMs);
    var base = Object.assign({
      dwell_time_ms:   dwellMs,
      visible_time_ms: visibleMs + (hiddenSince ? 0 : (Date.now() - startMs)),
      max_scroll_pct:  Math.round(maxScroll),
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
    }, getDeviceInfo());
    return Object.assign(base, extra || {});
  }

  // ─── Send (fetch primary, beacon fallback) ─────────────────────────────
  function send(apiUrl, siteKey, payload) {
    try {
      var url  = apiUrl + '/ingest/events?key=' + encodeURIComponent(siteKey);
      var body = JSON.stringify(payload);
      var ok = false;
      if (navigator.sendBeacon) {
        ok = navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }));
      }
      if (!ok && typeof fetch !== 'undefined') {
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: body,
          keepalive: true,
          mode: 'cors'
        }).catch(function(){});
      }
    } catch(_e) {}
  }

  // ─── PageView ─────────────────────────────────────────────────────────────
  function pageView() {
    var cfg = window.TRACKING_CONFIG;
    if (!cfg || !cfg.apiUrl || !cfg.siteKey) return;
    
    // Removido bloqueio agressivo de bot para não perder mobile
    // if (isBot()) return;

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
        content_type:  'product',
        referrer:      document.referrer,
        page_path:     location.pathname,
        client_user_agent: userData.client_user_agent,
        external_id:   userData.external_id,
        fbp:           userData.fbp,
        fbc:           userData.fbc
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

    // Pequeno delay para garantir que o pixel foi injetado antes de disparar
    setTimeout(function() {
      if (cfg.metaPixelId || hasFbq()) {
        trackMeta('PageView', Object.assign(
          { ta_source: 'tracking_suite', ta_site_key: cfg.siteKey, ta_event_id: eventId,
            event_url: location.origin + location.pathname,
            traffic_source: document.referrer || '' },
          telemetry,
          getTimeFields(eventTime),
          payload.custom_data
        ), eventId, false);
      }
    }, 250);

    if (cfg.gaMeasurementId) {
      loadGa(cfg.gaMeasurementId);
      trackGa('page_view', { page_location: location.href, page_title: document.title, page_path: location.pathname });
    }
  }

  // ─── PageEngagement ───────────────────────────────────────────────────────
  function pageEngagement() {
    try {
      var cfg = window.TRACKING_CONFIG;
      if (!cfg || !cfg.apiUrl || !cfg.siteKey) return;

      var eventTime = Math.floor(Date.now() / 1000);
      var eventId   = genEventId();
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
          event_url:    location.origin + location.pathname,
          client_user_agent: userData.client_user_agent,
          external_id:  userData.external_id,
          fbp:          userData.fbp,
          fbc:          userData.fbc
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

      var eventTime = Math.floor(Date.now() / 1000);
      var eventId   = genEventId();
      var attrs     = getAttributionParams();
      var userData  = buildUserData();
      var baseCustom = {
        page_title:       document.title,
        page_path:        location.pathname,
        content_type:     'product',
        event_url:        location.origin + location.pathname,
        client_user_agent: userData.client_user_agent,
        external_id:      userData.external_id,
        fbp:              userData.fbp,
        fbc:              userData.fbc
      };
      var telemetry = buildTelemetry({ page_path: location.pathname, page_title: document.title });

      var payload = {
        event_name:       eventName,
        event_time:       eventTime,
        event_id:         eventId,
        event_source_url: location.href,
        action_source:    'website',
        user_data:        userData,
        custom_data:      Object.assign({}, baseCustom, attrs, customData || {}),
        telemetry:        telemetry
      };

      getFingerprintHash(function(fp) {
        payload.telemetry.device_fingerprint = fp;
        send(cfg.apiUrl, cfg.siteKey, payload);
      });

      if (cfg.metaPixelId) {
        loadMetaPixel(cfg.metaPixelId);
      }
      if (cfg.metaPixelId || hasFbq()) {
        var isCustom = STANDARD_EVENTS.indexOf(eventName) < 0;
        var metaParams = Object.assign(
          {
            ta_source:   'tracking_suite',
            ta_site_key: cfg.siteKey,
            ta_event_id: eventId,
            event_url:   location.origin + location.pathname,
            event_source_url: location.href,
            page_title:  document.title
          },
          telemetry,
          getTimeFields(eventTime),
          payload.custom_data
        );
        trackMeta(eventName, metaParams, eventId, isCustom);
      }

      if (cfg.gaMeasurementId) {
        loadGa(cfg.gaMeasurementId);
        trackGa(eventName, customData);
      }
    } catch(_e) {}
  }

  // ─── URL rule engine (SPA support) ───────────────────────────────────────
  function checkUrlRules() {
    try {
      var cfg = window.TRACKING_CONFIG;
      if (!cfg || !cfg.eventRules || !cfg.eventRules.length) return;
      var currentPath = location.pathname + location.search;
      if (currentPath === lastPath) return;
      lastPath = currentPath;
      for (var i = 0; i < cfg.eventRules.length; i++) {
        var rule = cfg.eventRules[i];
        if (rule.rule_type === 'url_contains' && currentPath.indexOf(rule.match_value) >= 0) {
          track(rule.event_name, rule.custom_data || {});
        }
        if (rule.rule_type === 'url_equals' && currentPath === rule.match_value) {
          track(rule.event_name, rule.custom_data || {});
        }
      }
    } catch(_e) {}
  }

  // ─── Button rule engine ──────────────────────────────────────────────────
  function checkButtonRules(target) {
    try {
      var cfg = window.TRACKING_CONFIG;
      if (!cfg || !cfg.eventRules || !cfg.eventRules.length) return;
      if (!target) return;
      var currentPath = location.pathname + location.search;

      var el = target;
      while (el && el.tagName !== 'A' && el.tagName !== 'BUTTON' && el.parentElement) {
        if (el.tagName === 'BODY' || el.tagName === 'HTML') break;
        el = el.parentElement;
      }
      
      var clickedText = (el && (el.innerText || el.value) ? (el.innerText || el.value) : (target.innerText || target.value || '')).toString().trim().toLowerCase();
      if (!clickedText) return;

      for (var i = 0; i < cfg.eventRules.length; i++) {
        var rule = cfg.eventRules[i];
        if (rule.rule_type === 'button_click' && rule.match_value && rule.match_text) {
          if (rule.match_value === '/' || currentPath.indexOf(rule.match_value) >= 0) {
            var mText = rule.match_text.toLowerCase().trim();
            if (mText && clickedText.indexOf(mText) >= 0) {
              track(rule.event_name, rule.custom_data || {});
            }
          }
        }
      }
    } catch(_e) {}
  }

  // ─── History patch (SPA) ──────────────────────────────────────────────────
  try {
    var _pushState    = history.pushState;
    var _replaceState = history.replaceState;
    history.pushState = function() {
      _pushState.apply(history, arguments);
      setTimeout(function() { pageView(); checkUrlRules(); }, 0);
    };
    history.replaceState = function() {
      _replaceState.apply(history, arguments);
      setTimeout(checkUrlRules, 0);
    };
    window.addEventListener('popstate', function() {
      setTimeout(function() { pageView(); checkUrlRules(); }, 0);
    });
  } catch(_e) {}

  // ─── Expose public API ────────────────────────────────────────────────────
  try {
    window.taIdentify = function(obj) {
      try {
        applyIdentify(obj);
        window.__TA_IDENTIFY = Object.assign(window.__TA_IDENTIFY || {}, obj || {});
        // Re-init fbq com advanced matching atualizado
        if (window.fbq && window.TRACKING_CONFIG && window.TRACKING_CONFIG.metaPixelId) {
          var am = getMetaUserDataFromCookies();
          if (Object.keys(am).length > 0) {
            window.fbq('init', window.TRACKING_CONFIG.metaPixelId, am);
          }
        }
      } catch(_e) {}
    };

    if (window.TA_IDENTIFY) window.taIdentify(window.TA_IDENTIFY);

    window.tracker = { identify: window.taIdentify, track: track };
  } catch(_e) {}

  // ─── Auto-Tagging Checkout Links ──────────────────────────────────────────
  // Injeta tracking params (EID, FBC, FBP) nos links de checkout (sck/src)
  function decorateCheckoutLinks() {
    var eid = getOrCreateExternalId();
    var fbc = getFbc() || '';
    var fbp = getFbp() || '';
    
    // trk_ + Base64(eid|fbc|fbp)
    var trackValue = eid;
    if (fbc || fbp) trackValue += '|' + (fbc || '') + '|' + (fbp || '');
    var safeTrackValue = 'trk_' + btoa(trackValue).replace(/=+$/, '');

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
          var hasSck = url.searchParams.has('sck');
          var hasSrc = url.searchParams.has('src');
          
          if (!hasSck && !hasSrc) {
            var paramName = url.hostname.indexOf('hotmart') > -1 ? 'sck' : 'src';
            url.searchParams.set(paramName, safeTrackValue);
            link.href = url.toString();
          } else {
            var existingParam = hasSck ? 'sck' : 'src';
            var existingVal = url.searchParams.get(existingParam);
            if (existingVal && existingVal.indexOf('trk_') === -1) {
              url.searchParams.set(existingParam, existingVal + '-' + safeTrackValue);
              link.href = url.toString();
            }
          }
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

  // ─── Init ─────────────────────────────────────────────────────────────────
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    pageView();
    checkUrlRules();
    decorateCheckoutLinks();
  } else {
    document.addEventListener('DOMContentLoaded', function() {
      pageView();
      checkUrlRules();
      decorateCheckoutLinks();
    });
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

  window.addEventListener('beforeunload', pageEngagement);

})();
`;

  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60'); // 1-minute global cache for fast updates without overwhelming DB
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.send(js);
});

export default router;
