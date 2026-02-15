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
      window.fbq('init', pixelId);
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

    var payload={
      event_name:'PageView',
      event_time: Math.floor(Date.now()/1000),
      event_id: genEventId(),
      event_source_url: location.href,
      user_data:{
        client_user_agent: navigator.userAgent,
        fbp: getCookie('_fbp'),
        fbc: getFbc(),
        external_id: externalId
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
            content_type: payload.custom_data.content_type,
            page_title: payload.custom_data.page_title,
            page_path: payload.custom_data.page_path,
            page_location: payload.event_source_url,
            referrer: payload.custom_data.referrer,
            fbp: payload.user_data.fbp,
            fbc: payload.user_data.fbc,
            external_id: payload.user_data.external_id
          },
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
      var payload={
        event_name:'PageEngagement',
        event_time: Math.floor(Date.now()/1000),
        event_id: genEventId(),
        event_source_url: location.href,
        user_data:{
          client_user_agent: navigator.userAgent,
          fbp: getCookie('_fbp'),
          fbc: getFbc(),
          external_id: externalId
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
              event_source_url: payload.event_source_url,
              fbp: payload.user_data.fbp,
              fbc: payload.user_data.fbc,
              external_id: payload.user_data.external_id
            },
            payload.telemetry || {},
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
  if(document.readyState==='complete' || document.readyState==='interactive') pageView();
  else document.addEventListener('DOMContentLoaded', pageView);
  window.addEventListener('beforeunload', pageEngagement);
})();`;

  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.send(js);
});

export default router;

