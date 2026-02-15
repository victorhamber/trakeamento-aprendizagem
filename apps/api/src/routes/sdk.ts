import { Router } from 'express';

const router = Router();

router.get('/tracker.js', async (_req, res) => {
  const js = `
(function(){
  var startMs=Date.now();
  var maxScroll=0;
  var totalClicks=0;
  var ctaClicks=0;
  function getCookie(name){
    var value='; '+document.cookie;
    var parts=value.split('; '+name+'=');
    if(parts.length===2) return parts.pop().split(';').shift();
  }
  function setCookie(name, value, maxAgeSeconds){
    try{
      var cookie = name + '=' + encodeURIComponent(value) + '; path=/; samesite=lax';
      if(maxAgeSeconds) cookie += '; max-age=' + String(maxAgeSeconds);
      document.cookie = cookie;
    }catch(_e){}
  }
  function getOrCreateExternalId(){
    var v = getCookie('_ta_eid');
    if(v) return v;
    var id = 'eid_' + Math.random().toString(36).slice(2) + Date.now();
    setCookie('_ta_eid', id, 60*60*24*365*2);
    return id;
  }
  function toHex(buf){
    try{
      var b = new Uint8Array(buf);
      var out='';
      for(var i=0;i<b.length;i++){
        out += ('00' + b[i].toString(16)).slice(-2);
      }
      return out;
    }catch(_e){ return ''; }
  }
  function sha256Hex(str, cb){
    try{
      if(!str) return cb('');
      if(window.crypto && window.crypto.subtle && window.TextEncoder){
        var enc = new TextEncoder().encode(str);
        window.crypto.subtle.digest('SHA-256', enc).then(function(buf){
          cb(toHex(buf));
        }).catch(function(){ cb(''); });
        return;
      }
    }catch(_e){}
    cb('');
  }
  function normEmail(v){
    return (v||'').toString().trim().toLowerCase();
  }
  function normPhone(v){
    var s=(v||'').toString().trim();
    s=s.replace(/[^0-9+]/g,'');
    return s;
  }
  function normName(v){
    return (v||'').toString().trim().toLowerCase();
  }
  function normCityState(v){
    return (v||'').toString().trim().toLowerCase();
  }
  function normZip(v){
    return (v||'').toString().trim().toLowerCase().replace(/[ \\t\\r\\n]+/g,'');
  }
  function normDob(v){
    return (v||'').toString().trim().toLowerCase().replace(/[^0-9]/g,'');
  }
  function setHashedCookie(cookieName, rawValue, normalizer){
    try{
      var normalized = normalizer ? normalizer(rawValue) : (rawValue||'').toString();
      if(!normalized) return;
      sha256Hex(normalized, function(hash){
        if(hash) setCookie(cookieName, hash, 60*60*24*365*2);
      });
    }catch(_e){}
  }
  function getMetaUserDataFromCookies(){
    var out = {};
    var em = getCookie('_ta_em'); if(em) out.em = em;
    var ph = getCookie('_ta_ph'); if(ph) out.ph = ph;
    var fn = getCookie('_ta_fn'); if(fn) out.fn = fn;
    var ln = getCookie('_ta_ln'); if(ln) out.ln = ln;
    var ct = getCookie('_ta_ct'); if(ct) out.ct = ct;
    var st = getCookie('_ta_st'); if(st) out.st = st;
    var zp = getCookie('_ta_zp'); if(zp) out.zp = zp;
    var db = getCookie('_ta_db'); if(db) out.db = db;
    return out;
  }
  function observeFormsForPii(){
    function maybeCaptureFromForm(form){
      try{
        if(!form || !form.querySelectorAll) return;
        var inputs = form.querySelectorAll('input,select,textarea');
        for(var i=0;i<inputs.length;i++){
          var el = inputs[i];
          if(!el) continue;
          var name = ((el.name||'') + ' ' + (el.id||'') + ' ' + (el.getAttribute && el.getAttribute('autocomplete') || '')).toLowerCase();
          var type = ((el.type||'') + '').toLowerCase();
          var val = el.value;
          if(!val) continue;

          if(type==='email' || name.indexOf('email')>=0){
            setHashedCookie('_ta_em', val, normEmail);
            continue;
          }
          if(type==='tel' || name.indexOf('phone')>=0 || name.indexOf('telefone')>=0 || name.indexOf('cel')>=0 || name.indexOf('whats')>=0){
            setHashedCookie('_ta_ph', val, normPhone);
            continue;
          }
          if(name.indexOf('first')>=0 || name.indexOf('nome')>=0 || name.indexOf('firstname')>=0){
            setHashedCookie('_ta_fn', val, normName);
            continue;
          }
          if(name.indexOf('last')>=0 || name.indexOf('sobrenome')>=0 || name.indexOf('lastname')>=0){
            setHashedCookie('_ta_ln', val, normName);
            continue;
          }
          if(name.indexOf('city')>=0 || name.indexOf('cidade')>=0){
            setHashedCookie('_ta_ct', val, normCityState);
            continue;
          }
          if(name.indexOf('state')>=0 || name.indexOf('estado')>=0 || name.indexOf('uf')>=0){
            setHashedCookie('_ta_st', val, normCityState);
            continue;
          }
          if(name.indexOf('zip')>=0 || name.indexOf('cep')>=0 || name.indexOf('postal')>=0){
            setHashedCookie('_ta_zp', val, normZip);
            continue;
          }
          if(type==='date' || name.indexOf('birth')>=0 || name.indexOf('nasc')>=0 || name.indexOf('dob')>=0){
            setHashedCookie('_ta_db', val, normDob);
            continue;
          }
        }
      }catch(_e){}
    }

    document.addEventListener('submit', function(e){
      try{
        maybeCaptureFromForm(e.target);
      }catch(_e){}
    }, true);

    document.addEventListener('change', function(e){
      try{
        var el = e.target;
        if(!el) return;
        var form = el.form;
        if(form) maybeCaptureFromForm(form);
      }catch(_e){}
    }, true);
  }
  function getByPath(obj, path){
    try{
      if(!obj || !path) return undefined;
      var cur=obj;
      var parts=path.split('.');
      for(var i=0;i<parts.length;i++){
        var k=parts[i];
        if(!k) return undefined;
        if(cur && Object.prototype.hasOwnProperty.call(cur, k)) cur=cur[k];
        else return undefined;
      }
      return cur;
    }catch(_e){ return undefined; }
  }
  function coerceString(v){
    if(v==null) return '';
    if(Array.isArray(v)){
      for(var i=0;i<v.length;i++){
        var s=coerceString(v[i]);
        if(s) return s;
      }
      return '';
    }
    if(typeof v==='string') return v;
    if(typeof v==='number') return String(v);
    return '';
  }
  function applyIdentify(raw){
    try{
      var cfg=window.TRACKING_CONFIG;
      if(!cfg || !cfg.identifyMap) return;
      if(!raw || typeof raw!=='object') return;

      function pick(keys){
        if(!keys || !keys.length) return '';
        for(var i=0;i<keys.length;i++){
          var k=keys[i];
          if(!k) continue;
          var v = Object.prototype.hasOwnProperty.call(raw, k) ? raw[k] : getByPath(raw, k);
          var s = coerceString(v);
          if(s) return s;
        }
        return '';
      }

      var email = pick(cfg.identifyMap.email);
      if(email) setHashedCookie('_ta_em', email, normEmail);

      var phone = pick(cfg.identifyMap.phone);
      if(phone) setHashedCookie('_ta_ph', phone, normPhone);

      var fn = pick(cfg.identifyMap.fn);
      if(fn) setHashedCookie('_ta_fn', fn, normName);

      var ln = pick(cfg.identifyMap.ln);
      if(ln) setHashedCookie('_ta_ln', ln, normName);

      var ct = pick(cfg.identifyMap.ct);
      if(ct) setHashedCookie('_ta_ct', ct, normCityState);

      var st = pick(cfg.identifyMap.st);
      if(st) setHashedCookie('_ta_st', st, normCityState);

      var zp = pick(cfg.identifyMap.zp);
      if(zp) setHashedCookie('_ta_zp', zp, normZip);

      var db = pick(cfg.identifyMap.db);
      if(db) setHashedCookie('_ta_db', db, normDob);

    }catch(_e){}
  }
  function getFbc(){
    var fbc = getCookie('_fbc');
    if(fbc) return fbc;
    try{
      var url = new URL(location.href);
      var fbclid = url.searchParams.get('fbclid');
      if(fbclid) return 'fb.1.'+Date.now()+'.'+fbclid;
    }catch(_e){}
    return undefined;
  }
  function getUtm(){
    try{
      var url = new URL(location.href);
      var out = {};
      ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'].forEach(function(k){
        var v = url.searchParams.get(k);
        if(v) out[k]=v;
      });
      return out;
    }catch(_e){ return {}; }
  }
  function getTimeFields(epochSec){
    try{
      var d = new Date(epochSec * 1000);
      var days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
      var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      var h = d.getHours();
      return {
        event_time: epochSec,
        event_day: days[d.getDay()],
        event_day_in_month: d.getDate(),
        event_month: months[d.getMonth()],
        event_time_interval: String(h) + '-' + String(h + 1)
      };
    }catch(_e){
      return { event_time: epochSec };
    }
  }
  function genEventId(){
    return 'evt_'+Math.random().toString(36).slice(2)+Date.now();
  }
  function send(apiUrl, siteKey, payload){
    try{
      if(navigator.sendBeacon){
        var blob=new Blob([JSON.stringify(payload)],{type:'application/json'});
        navigator.sendBeacon(apiUrl+'/ingest/events?key='+encodeURIComponent(siteKey), blob);
      }else{
        fetch(apiUrl+'/ingest/events',{method:'POST',headers:{'Content-Type':'application/json','X-Site-Key':siteKey},body:JSON.stringify(payload)});
      }
    }catch(_e){}
  }
  var metaLoaded=false;
  function loadMetaPixel(pixelId){
    try{
      if(!pixelId || metaLoaded) return;
      metaLoaded=true;
      !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
      var am = getMetaUserDataFromCookies();
      window.fbq('init', pixelId, am);
    }catch(_e){}
  }
  function trackMeta(eventName, params, eventId, isCustom){
    try{
      if(!window.fbq) return;
      if(isCustom) window.fbq('trackCustom', eventName, params || {}, eventId ? { eventID: eventId } : undefined);
      else window.fbq('track', eventName, params || {}, eventId ? { eventID: eventId } : undefined);
    }catch(_e){}
  }
  var gaLoaded=false;
  function loadGa(measurementId){
    try{
      if(!measurementId || gaLoaded) return;
      gaLoaded=true;
      window.dataLayer = window.dataLayer || [];
      window.gtag = window.gtag || function(){ window.dataLayer.push(arguments); };
      var s=document.createElement('script');
      s.async=true;
      s.src='https://www.googletagmanager.com/gtag/js?id='+encodeURIComponent(measurementId);
      var f=document.getElementsByTagName('script')[0];
      if(f && f.parentNode) f.parentNode.insertBefore(s,f);
      window.gtag('js', new Date());
      window.gtag('config', measurementId, { send_page_view: false });
    }catch(_e){}
  }
  function trackGa(eventName, params){
    try{
      if(!window.gtag) return;
      window.gtag('event', eventName, params || {});
    }catch(_e){}
  }
  function getScrollPct(){
    try{
      var doc=document.documentElement;
      var body=document.body;
      var scrollTop=(window.pageYOffset || doc.scrollTop || body.scrollTop || 0);
      var scrollHeight=Math.max(doc.scrollHeight, body.scrollHeight, 1);
      var clientHeight=Math.max(doc.clientHeight, body.clientHeight, 1);
      var denom=Math.max(scrollHeight - clientHeight, 1);
      var pct=Math.min(100, Math.max(0, (scrollTop/denom)*100));
      return pct;
    }catch(_e){ return 0; }
  }
  function trackScroll(){
    maxScroll=Math.max(maxScroll, getScrollPct());
  }
  function isCta(el){
    try{
      if(!el) return false;
      var tag=(el.tagName||'').toUpperCase();
      if(tag==='BUTTON') return true;
      if(tag==='A' && el.getAttribute('href')) return true;
      var role=el.getAttribute && el.getAttribute('role');
      if(role==='button') return true;
      var cls=(el.className||'').toString().toLowerCase();
      if(cls.indexOf('cta')>=0) return true;
      var txt=(el.innerText||'').toString().trim().toLowerCase();
      if(txt==='comprar' || txt==='quero comprar' || txt==='saiba mais' || txt==='falar no whatsapp' || txt==='falar no whatsapp agora') return true;
      return false;
    }catch(_e){ return false; }
  }
  function trackClicks(){
    document.addEventListener('click', function(e){
      totalClicks++;
      var el=e.target;
      while(el && el.tagName && el.tagName!=='A' && el.tagName!=='BUTTON'){ el=el.parentElement; }
      if(isCta(el)) ctaClicks++;
    }, true);
  }
  function autoTagLinks(){
    document.addEventListener('click', function(e){
      var el=e.target;
      while(el && el.tagName!=='A'){ el=el.parentElement; }
      if(!el || !el.href) return;
      try{
        var url=new URL(el.href);
        if(url.hostname===location.hostname) return;
        var fbp=getCookie('_fbp');
        var fbc=getFbc();
        if(fbp) url.searchParams.set('fbp', fbp);
        if(fbc) url.searchParams.set('fbc', fbc);
        var cur=new URL(location.href);
        ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'].forEach(function(k){
          var v=cur.searchParams.get(k);
          if(v) url.searchParams.set(k,v);
        });
        el.href=url.toString();
      }catch(_e){}
    }, true);
  }
  function pageView(){
    var cfg=window.TRACKING_CONFIG;
    if(!cfg || !cfg.apiUrl || !cfg.siteKey) return;
    var nav=performance && performance.timing ? performance.timing : null;
    var loadTimeMs=nav ? (nav.domContentLoadedEventEnd - nav.navigationStart) : undefined;
    var utm = getUtm();
    var externalId = getOrCreateExternalId();
    var metaUser = getMetaUserDataFromCookies();

    var payload={
      event_name:'PageView',
      event_time: Math.floor(Date.now()/1000),
      event_id: genEventId(),
      event_source_url: location.href,
      user_data:{
        client_user_agent: navigator.userAgent,
        fbp: getCookie('_fbp'),
        fbc: getFbc(),
        external_id: externalId,
        em: metaUser.em,
        ph: metaUser.ph,
        fn: metaUser.fn,
        ln: metaUser.ln,
        ct: metaUser.ct,
        st: metaUser.st,
        zp: metaUser.zp,
        db: metaUser.db
      },
      custom_data: {
         page_title: document.title,
         content_type: 'product',
         referrer: document.referrer,
         page_path: location.pathname
      }
    };
    if(nav && loadTimeMs) payload.custom_data.load_time_ms = loadTimeMs;
    send(cfg.apiUrl, cfg.siteKey, payload);
    if(cfg.metaPixelId){
      loadMetaPixel(cfg.metaPixelId);
      trackMeta(
        'PageView',
        Object.assign(
          {
            ta_source: 'tracking_suite',
            ta_site_key: cfg.siteKey,
            ta_event_id: payload.event_id,
            event_url: (location.origin || '') + (location.pathname || '/'),
            event_source_url: payload.event_source_url,
            traffic_source: document.referrer || '',
            client_user_agent: navigator.userAgent,
            content_type: payload.custom_data.content_type,
            page_title: payload.custom_data.page_title,
            page_path: payload.custom_data.page_path,
            page_location: payload.event_source_url,
            referrer: payload.custom_data.referrer,
            fbp: payload.user_data.fbp,
            fbc: payload.user_data.fbc,
            external_id: payload.user_data.external_id,
            em: payload.user_data.em,
            ph: payload.user_data.ph,
            fn: payload.user_data.fn,
            ln: payload.user_data.ln,
            ct: payload.user_data.ct,
            st: payload.user_data.st,
            zp: payload.user_data.zp,
            db: payload.user_data.db
          },
          getTimeFields(payload.event_time),
          utm
        ),
        payload.event_id,
        false
      );
    }
    if(cfg.gaMeasurementId){
      loadGa(cfg.gaMeasurementId);
      trackGa('page_view', { page_location: location.href, page_title: document.title, page_path: location.pathname });
    }
  }
  function pageEngagement(){
    try{
      var cfg=window.TRACKING_CONFIG;
      if(!cfg || !cfg.apiUrl || !cfg.siteKey) return;
      var dwellMs=Math.max(0, Date.now()-startMs);
      var utm = getUtm();
      var externalId = getOrCreateExternalId();
      var metaUser = getMetaUserDataFromCookies();
      var payload={
        event_name:'PageEngagement',
        event_time: Math.floor(Date.now()/1000),
        event_id: genEventId(),
        event_source_url: location.href,
        user_data:{
          client_user_agent: navigator.userAgent,
          fbp: getCookie('_fbp'),
          fbc: getFbc(),
          external_id: externalId,
          em: metaUser.em,
          ph: metaUser.ph,
          fn: metaUser.fn,
          ln: metaUser.ln,
          ct: metaUser.ct,
          st: metaUser.st,
          zp: metaUser.zp,
          db: metaUser.db
        },
        telemetry:{
          dwell_time_ms: dwellMs,
          max_scroll_pct: Math.round(maxScroll),
          clicks_total: totalClicks,
          clicks_cta: ctaClicks,
          page_path: location.pathname || '',
          page_title: document.title || ''
        }
      };
      send(cfg.apiUrl, cfg.siteKey, payload);
      if(cfg.metaPixelId){
        loadMetaPixel(cfg.metaPixelId);
        trackMeta(
          'PageEngagement',
          Object.assign(
            {
              ta_source: 'tracking_suite',
              ta_site_key: cfg.siteKey,
              ta_event_id: payload.event_id,
              event_url: (location.origin || '') + (location.pathname || '/'),
              event_source_url: payload.event_source_url,
              traffic_source: document.referrer || '',
              client_user_agent: navigator.userAgent,
              fbp: payload.user_data.fbp,
              fbc: payload.user_data.fbc,
              external_id: payload.user_data.external_id,
              em: payload.user_data.em,
              ph: payload.user_data.ph,
              fn: payload.user_data.fn,
              ln: payload.user_data.ln,
              ct: payload.user_data.ct,
              st: payload.user_data.st,
              zp: payload.user_data.zp,
              db: payload.user_data.db
            },
            payload.telemetry || {},
            getTimeFields(payload.event_time),
            utm
          ),
          payload.event_id,
          true
        );
      }
      if(cfg.gaMeasurementId){
        loadGa(cfg.gaMeasurementId);
        trackGa('page_engagement', payload.telemetry);
      }
    }catch(_e){}
  }
  window.addEventListener('scroll', trackScroll, { passive:true });
  trackClicks();
  autoTagLinks();
  observeFormsForPii();
  try{
    window.taIdentify = function(obj){
      try{
        applyIdentify(obj);
        window.__TA_IDENTIFY = Object.assign(window.__TA_IDENTIFY || {}, obj || {});
      }catch(_e){}
    };
    if(window.TA_IDENTIFY) window.taIdentify(window.TA_IDENTIFY);
  }catch(_e){}
  if(document.readyState==='complete' || document.readyState==='interactive') pageView();
  else document.addEventListener('DOMContentLoaded', pageView);
  window.addEventListener('beforeunload', pageEngagement);
})();`;

  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.send(js);
});

export default router;

