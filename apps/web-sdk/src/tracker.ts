export interface EventPayload {
  event_name: string;
  event_time: number;
  event_id: string;
  event_source_url: string;
  user_data: {
    client_user_agent: string;
    fbp?: string;
    fbc?: string;
    external_id?: string;
    email?: string;
    phone?: string;
    fn?: string;
    ln?: string;
    ct?: string;
    st?: string;
    zp?: string;
    db?: string;
  };
  custom_data?: Record<string, any>;
  telemetry?: {
    load_time_ms?: number;
    screen_width: number;
    screen_height: number;
  };
}

export class Tracker {
  private apiUrl: string;
  private siteKey: string;
  private eventRules: Array<{ rule_type: string; match_value: string; event_name: string }> = [];
  private lastPath: string = '';

  constructor(apiUrl: string, siteKey: string, eventRules: any[] = []) {
    this.apiUrl = apiUrl;
    this.siteKey = siteKey;
    this.eventRules = eventRules;
    this.init();
  }

  private init() {
    this.trackPageView();
    this.autoTagLinks();
    this.setupUrlRules();
  }

  public identify(userData: Record<string, any>) {
    try {
      const existing = JSON.parse(localStorage.getItem('ta_user_data') || '{}');
      const updated = { ...existing, ...userData };
      localStorage.setItem('ta_user_data', JSON.stringify(updated));
    } catch (e) {
      console.error('Error saving user data', e);
    }
  }

  private setupUrlRules() {
    this.checkUrlRules();
    
    const pushState = history.pushState;
    history.pushState = (...args) => {
      pushState.apply(history, args);
      this.checkUrlRules();
    };

    const replaceState = history.replaceState;
    history.replaceState = (...args) => {
      replaceState.apply(history, args);
      this.checkUrlRules();
    };

    window.addEventListener('popstate', () => {
      this.checkUrlRules();
    });
  }

  private checkUrlRules() {
    const currentPath = window.location.pathname + window.location.search;
    if (currentPath === this.lastPath) return;
    this.lastPath = currentPath;

    this.eventRules.forEach(rule => {
      if (rule.rule_type === 'url_contains' && currentPath.includes(rule.match_value)) {
        this.track(rule.event_name);
      }
    });
  }

  private getCookie(name: string): string | undefined {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop()?.split(';').shift();
  }

  private setCookie(name: string, value: string, maxAgeSeconds?: number) {
    const cookie = [`${name}=${encodeURIComponent(value)}`, 'path=/', 'samesite=lax'];
    if (maxAgeSeconds) cookie.push(`max-age=${maxAgeSeconds}`);
    document.cookie = cookie.join('; ');
  }

  private getOrCreateExternalId(): string {
    const existing = this.getCookie('_ta_eid');
    if (existing) return existing;
    const id = `eid_${Math.random().toString(36).slice(2)}${Date.now()}`;
    this.setCookie('_ta_eid', id, 60 * 60 * 24 * 365 * 2);
    return id;
  }

  private getFbc(): string | undefined {
    const existing = this.getCookie('_fbc');
    if (existing) return existing;
    try {
      const url = new URL(window.location.href);
      const fbclid = url.searchParams.get('fbclid');
      if (fbclid) {
        const generated = `fb.1.${Date.now()}.${fbclid}`;
        this.setCookie('_fbc', generated, 60 * 60 * 24 * 90);
        return generated;
      }
    } catch {
      return undefined;
    }
  }

  private getAttributionParams(): Record<string, string> {
    const out: Record<string, string> = {};
    try {
      const url = new URL(window.location.href);
      const keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'click_id'];
      keys.forEach((k) => {
        const v = url.searchParams.get(k);
        if (v) {
          out[k] = v;
          try {
            sessionStorage.setItem(`ta_${k}`, v);
          } catch {
            return;
          }
        } else {
          try {
            const stored = sessionStorage.getItem(`ta_${k}`);
            if (stored) out[k] = stored;
          } catch {
            return;
          }
        }
      });
    } catch {
      return out;
    }
    return out;
  }

  private generateEventId(): string {
    return 'evt_' + Math.random().toString(36).substr(2, 9) + Date.now();
  }

  private getTimeFields(epochSec: number) {
    try {
      const d = new Date(epochSec * 1000);
      const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
      const months = [
        'January','February','March','April','May','June',
        'July','August','September','October','November','December'
      ];
      const h = d.getHours();
      return {
        event_day: days[d.getDay()],
        event_day_in_month: d.getDate(),
        event_month: months[d.getMonth()],
        event_time_interval: `${h}-${h + 1}`,
        event_hour: h,
      };
    } catch {
      return {};
    }
  }

  public track(eventName: string, customData?: Record<string, any>) {
    const eventId = this.generateEventId();
    const eventTime = Math.floor(Date.now() / 1000);
    const attrs = this.getAttributionParams();
    let userData: any = {
      client_user_agent: navigator.userAgent,
      fbp: this.getCookie('_fbp'),
      fbc: this.getFbc(),
      external_id: this.getOrCreateExternalId(),
    };

    try {
      const stored = JSON.parse(localStorage.getItem('ta_user_data') || '{}');
      userData = { ...userData, ...stored };
    } catch {}

    const baseCustom = {
      page_title: document.title,
      page_path: window.location.pathname,
      content_type: 'product',
      event_url: window.location.origin + window.location.pathname,
      event_source_url: window.location.href,
      client_user_agent: userData.client_user_agent,
      external_id: userData.external_id,
      fbp: userData.fbp,
      fbc: userData.fbc,
      ...this.getTimeFields(eventTime),
    };

    const payload: EventPayload = {
      event_name: eventName,
      event_time: eventTime,
      event_id: eventId,
      event_source_url: window.location.href,
      user_data: userData,
      custom_data: { ...baseCustom, ...attrs, ...(customData || {}) },
      telemetry: {
        load_time_ms: window.performance?.timing?.domContentLoadedEventEnd - window.performance?.timing?.navigationStart,
        screen_width: window.screen.width,
        screen_height: window.screen.height
      }
    };

    this.sendToClientPixels(eventName, eventId, {
      ...(payload.custom_data || {}),
      ...(payload.telemetry || {}),
    });
    this.send(payload);
  }

  private sendToClientPixels(eventName: string, eventId: string, customData: Record<string, any>) {
    const w = window as any;

    const hasFbq = typeof w.fbq === 'function';
    if (hasFbq) {
      try {
        w.fbq('track', eventName, customData, { eventID: eventId });
      } catch {}
    }

    const hasGtag = typeof w.gtag === 'function';
    if (hasGtag) {
      try {
        w.gtag('event', eventName, { ...customData, event_id: eventId });
      } catch {}
    }
  }

  private send(payload: EventPayload) {
    const url = `${this.apiUrl}/ingest/events?key=${this.siteKey}`;
    const body = JSON.stringify(payload);
     
     // Debug log (Habilitado temporariamente para diagnóstico)
     console.log('[TRK] Sending event:', payload.event_name, payload, 'to', url);
 
     // Try fetch with keepalive first (modern standard)
     if (typeof window.fetch === 'function') {
       fetch(url, {
         method: 'POST',
         headers: {
           'Content-Type': 'application/json',
           'X-Site-Key': this.siteKey
         },
         body: body,
         keepalive: true
       }).then(res => {
         if (!res.ok) console.error('[TRK] Server error:', res.status, res.statusText);
         else console.log('[TRK] Event sent successfully');
       }).catch((err) => {
         console.error('[TRK] Fetch error:', err);
       });
       return;
     }
    
    // Fallback to sendBeacon
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon(url, blob);
    }
  }

  private trackPageView() {
    this.track('PageView');
  }

  // Funcionalidade crucial: Auto-Tagging de Links para Checkout
  private autoTagLinks() {
    document.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('a');
      if (target && target.href) {
        const url = new URL(target.href);
        const fbp = this.getCookie('_fbp');
        const fbc = this.getFbc();
        const externalId = this.getOrCreateExternalId();
        
        // Se o link for externo (checkout), injeta os parâmetros
        if (url.hostname !== window.location.hostname) {
          if (fbp) url.searchParams.set('fbp', fbp);
          if (fbc) url.searchParams.set('fbc', fbc);
          if (externalId) url.searchParams.set('external_id', externalId);
          
          const attrs = this.getAttributionParams();
          Object.entries(attrs).forEach(([key, value]) => {
            if (value) url.searchParams.set(key, value);
          });

          target.href = url.toString();
        }
      }
    });
  }
}

// Inicialização automática se script configurado
try {
  if ((window as any).TRACKING_CONFIG) {
    const config = (window as any).TRACKING_CONFIG;
    console.log('[TRK] Initializing tracker with config:', config);
    (window as any).tracker = new Tracker(config.apiUrl, config.siteKey, config.eventRules);
  } else {
    console.warn('[TRK] TRACKING_CONFIG not found on window');
  }
} catch (e) {
  console.error('[TRK] Failed to initialize tracker:', e);
}
