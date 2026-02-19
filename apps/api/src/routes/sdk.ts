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
    var digits=s.replace(/[^0-9]/g,'');
    if(!digits) return '';
    return '+' + digits;
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
  function autoExtractIdentify(raw){
    var out = { email:'', phone:'', fn:'', ln:'', ct:'', st:'', zp:'', db:'' };
    var seen = [];
    function consider(key, val){
      var s = coerceString(val);
      if(!s) return;
      var k = (key||'').toString().toLowerCase();
      if(!out.email && (k==='email' || k.indexOf('email')>=0 || k.indexOf('e-mail')>=0)) { out.email = s; return; }
      if(!out.phone && (k==='phone' || k.indexOf('phone')>=0 || k.indexOf('telefone')>=0 || k.indexOf('cel')>=0 || k.indexOf('whats')>=0 || k.indexOf('fone')>=0)) { out.phone = s; return; }
      if(!out.fn && (k==='fn' || k.indexOf('first')>=0 || k.indexOf('nome')>=0 || k.indexOf('firstname')>=0)) { out.fn = s; return; }
      if(!out.ln && (k==='ln' || k.indexOf('last')>=0 || k.indexOf('sobrenome')>=0 || k.indexOf('lastname')>=0)) { out.ln = s; return; }
      if(!out.ct && (k==='ct' || k.indexOf('city')>=0 || k.indexOf('cidade')>=0)) { out.ct = s; return; }
      if(!out.st && (k==='st' || k.indexOf('state')>=0 || k.indexOf('estado')>=0 || k==='uf')) { out.st = s; return; }
      if(!out.zp && (k==='zp' || k.indexOf('zip')>=0 || k.indexOf('cep')>=0 || k.indexOf('postal')>=0)) { out.zp = s; return; }
      if(!out.db && (k==='db' || k.indexOf('birth')>=0 || k.indexOf('nasc')>=0 || k.indexOf('dob')>=0 || k.indexOf('birthday')>=0)) { out.db = s; return; }
    }
    function walk(obj, depth){
      if(!obj || depth>4) return;
      if(Array.isArray(obj)){
        for(var i=0;i<obj.length;i++) walk(obj[i], depth+1);
        return;
      }
      if(typeof obj !== 'object') return;
      if(seen.indexOf(obj)>=0) return;
      seen.push(obj);
      for(var k in obj){
        if(!Object.prototype.hasOwnProperty.call(obj, k)) continue;
        var v = obj[k];
        consider(k, v);
        if(typeof v === 'object') walk(v, depth+1);
      }
    }
    walk(raw, 0);
    return out;
  }
  function applyIdentify(raw){
    try{
      var cfg=window.TRACKING_CONFIG;
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
      var email = pick(['email','e-mail']);
      if(email) setHashedCookie('_ta_em', email, normEmail);

      var phone = pick(['phone','telefone','cel','whats','fone']);
      if(phone) setHashedCookie('_ta_ph', phone, normPhone);

      var fn = pick(['fn','first_name','firstname','nome']);
      if(fn) setHashedCookie('_ta_fn', fn, normName);

      var ln = pick(['ln','last_name','lastname','sobrenome']);
      if(ln) setHashedCookie('_ta_ln', ln, normName);

      var auto = autoExtractIdentify(raw);
      if(auto.ct) setHashedCookie('_ta_ct', auto.ct, normCityState);
      if(auto.st) setHashedCookie('_ta_st', auto.st, normCityState);
      if(auto.zp) setHashedCookie('_ta_zp', auto.zp, normZip);
      if(auto.db) setHashedCookie('_ta_db', auto.db, normDob);

    }catch(_e){}
  }
  function getFbc(){
    var fbc = getCookie('_fbc');
    if(fbc) return fbc;
    try{
      var url = new URL(location.href);
      var fbclid = url.searchParams.get('fbclid');
      if(fbclid){
        var generated = 'fb.1.'+Date.now()+'.'+fbclid;
        setCookie('_fbc', generated, 60*60*24*90);
        return generated;
      }
    }catch(_e){}
    return undefined;
  }
  function getAttributionParams(){
    var out = {};
    try{
      var url = new URL(location.href);
      var keys = ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','click_id'];
      for(var i=0;i<keys.length;i++){
        var k = keys[i];
        var v = url.searchParams.get(k);
        if(v){
          out[k]=v;
          try{ sessionStorage.setItem('ta_'+k, v); }catch(_e){}
        }else{
          try{
            var sv = sessionStorage.getItem('ta_'+k);
            if(sv) out[k]=sv;
          }catch(_e){}
        }
      }
    }catch(_e){}
    return out;
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
      var opts = eventId ? { eventID: eventId } : {};
      
      // Ensure params has advanced matching data if available, even if not passed explicitly
      if(params && typeof params === 'object') {
         // Se params já tem em/ph/fn/ln, o pixel usará. 
         // Mas para garantir, podemos reinjetar do cookie se estiver vazio no params
         var am = getMetaUserDataFromCookies();
         if(!params.em && am.em) params.em = am.em;
         if(!params.ph && am.ph) params.ph = am.ph;
         if(!params.fn && am.fn) params.fn = am.fn;
         if(!params.ln && am.ln) params.ln = am.ln;
         if(!params.ct && am.ct) params.ct = am.ct;
         if(!params.st && am.st) params.st = am.st;
         if(!params.zp && am.zp) params.zp = am.zp;
         if(!params.db && am.db) params.db = am.db;
         if(!params.external_id && am.external_id) params.external_id = am.external_id;
      }

      if(isCustom) window.fbq('trackCustom', eventName, params || {}, opts);
      else window.fbq('track', eventName, params || {}, opts);
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
        var externalId = getOrCreateExternalId();
        if(fbp) url.searchParams.set('fbp', fbp);
        if(fbc) url.searchParams.set('fbc', fbc);
        if(externalId) url.searchParams.set('external_id', externalId);
        var attrs = getAttributionParams();
        var keys = Object.keys(attrs);
        for(var i=0;i<keys.length;i++){
          var k = keys[i];
          var v = attrs[k];
          if(v) url.searchParams.set(k, v);
        }
        el.href=url.toString();
      }catch(_e){}
    }, true);
  }
  function pageView(){
    var cfg=window.TRACKING_CONFIG;
    if(!cfg || !cfg.apiUrl || !cfg.siteKey) return;
    var nav=performance && performance.timing ? performance.timing : null;
    var loadTimeMs=nav ? (nav.domContentLoadedEventEnd - nav.navigationStart) : undefined;
    var attrs = getAttributionParams();
    var externalId = getOrCreateExternalId();
    var metaUser = getMetaUserDataFromCookies();
    var telemetrySnapshot={
      dwell_time_ms: 0,
      max_scroll_pct: Math.round(maxScroll),
      clicks_total: totalClicks,
      clicks_cta: ctaClicks,
      page_path: location.pathname || '',
      page_title: document.title || ''
    };

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
      custom_data: Object.assign(
        {
          page_title: document.title,
          content_type: 'product',
          referrer: document.referrer,
          page_path: location.pathname
        },
        attrs
      ),
      telemetry: telemetrySnapshot
    };
    if(nav && loadTimeMs){
      payload.custom_data.load_time_ms = loadTimeMs;
      payload.telemetry.load_time_ms = loadTimeMs;
    }
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
          payload.telemetry || {},
          getTimeFields(payload.event_time),
          attrs
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
      var attrs = getAttributionParams();
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
        },
        custom_data: attrs
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
            attrs
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

  function track(eventName, customData){
    try{
      var cfg=window.TRACKING_CONFIG;
      if(!cfg || !cfg.apiUrl || !cfg.siteKey) return;
      
      var fbp=getCookie('_fbp');
      var fbc=getFbc();
      var externalId=getOrCreateExternalId();
      var attrs=getAttributionParams();
      var userData={
        client_user_agent:navigator.userAgent,
        fbp:fbp,
        fbc:fbc,
        external_id:externalId,
        em:getCookie('_ta_em'),
        ph:getCookie('_ta_ph'),
        fn:getCookie('_ta_fn'),
        ln:getCookie('_ta_ln'),
        ct:getCookie('_ta_ct'),
        st:getCookie('_ta_st'),
        zp:getCookie('_ta_zp'),
        db:getCookie('_ta_db')
      };

      var payload = {
        event_name: eventName,
        event_time: Math.floor(Date.now()/1000),
        event_id: genEventId(),
        event_source_url: window.location.href,
        user_data: userData,
        custom_data: Object.assign({}, attrs, customData || {}),
        telemetry: {
          load_time_ms: 0,
          screen_width: window.screen.width,
          screen_height: window.screen.height
        }
      };
      
      send(cfg.apiUrl, cfg.siteKey, payload);
      
      if(cfg.metaPixelId){
        loadMetaPixel(cfg.metaPixelId);
        // Determine if standard or custom
        var standards = ['AddPaymentInfo','AddToCart','AddToWishlist','CompleteRegistration','Contact','CustomizeProduct','Donate','FindLocation','InitiateCheckout','Lead','Purchase','Schedule','Search','StartTrial','SubmitApplication','Subscribe','ViewContent','PageView'];
        var isCustom = standards.indexOf(eventName) < 0;
        trackMeta(eventName, customData, payload.event_id, isCustom);
      }
      if(cfg.gaMeasurementId){
        loadGa(cfg.gaMeasurementId);
        trackGa(eventName, customData);
      }
    }catch(_e){}
  }

  var lastPath = '';
  function checkUrlRules(){
    try{
      var cfg=window.TRACKING_CONFIG;
      if(!cfg || !cfg.eventRules || !cfg.eventRules.length) return;
      var currentPath = window.location.pathname + window.location.search;
      if(currentPath === lastPath) return;
      lastPath = currentPath;
      
      for(var i=0; i<cfg.eventRules.length; i++){
        var rule = cfg.eventRules[i];
        if(rule.rule_type === 'url_contains' && currentPath.indexOf(rule.match_value) >= 0){
          track(rule.event_name);
        }
      }
    }catch(_e){}
  }

  try{
    var pushState = history.pushState;
    history.pushState = function(){
      pushState.apply(history, arguments);
      checkUrlRules();
    };
    var replaceState = history.replaceState;
    history.replaceState = function(){
      replaceState.apply(history, arguments);
      checkUrlRules();
    };
    window.addEventListener('popstate', checkUrlRules);
  }catch(_e){}

  try{
    window.taIdentify = function(obj){
      try{
        applyIdentify(obj);
        window.__TA_IDENTIFY = Object.assign(window.__TA_IDENTIFY || {}, obj || {});
      }catch(_e){}
    };
    if(window.TA_IDENTIFY) window.taIdentify(window.TA_IDENTIFY);

    window.tracker = {
      identify: window.taIdentify,
      track: track
    };
  }catch(_e){}

  if(document.readyState==='complete' || document.readyState==='interactive') {
    pageView();
    checkUrlRules();
  } else {
    document.addEventListener('DOMContentLoaded', function(){
      pageView();
      checkUrlRules();
    });
  }
  window.addEventListener('beforeunload', pageEngagement);
})();`;

  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.send(js);
});

export default router;
