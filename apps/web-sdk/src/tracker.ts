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
  private engagementInterval: number | null = null;
  private startTime: number = Date.now();
  private maxScroll: number = 0;

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
    this.setupFormListeners();
    this.setupEngagementTracking();
  }

  private setupEngagementTracking() {
    // Scroll listener
    window.addEventListener('scroll', () => {
      const h = document.documentElement;
      const b = document.body;
      const st = 'scrollTop';
      const sh = 'scrollHeight';
      const pct = Math.round((h[st] || b[st]) / ((h[sh] || b[sh]) - h.clientHeight) * 100);
      if (pct > this.maxScroll) this.maxScroll = pct;
    }, { passive: true });

    // Heartbeat: envia dados a cada 15s se houver atividade
    this.engagementInterval = window.setInterval(() => {
      this.sendEngagement();
    }, 15000);

    // Envio final ao sair
    window.addEventListener('beforeunload', () => {
      this.sendEngagement(true);
    });
  }

  private sendEngagement(isFinal = false) {
    const dwellTime = Date.now() - this.startTime;
    if (dwellTime < 1000) return; // Ignora muito curto

    const payload: EventPayload = {
      event_name: 'PageEngagement',
      event_time: Math.floor(Date.now() / 1000),
      event_id: `eng_${this.getCookie('_ta_eid')}_${this.lastPath.replace(/[^a-z0-9]/gi, '')}`, // ID estável por página/sessão
      event_source_url: window.location.href,
      user_data: {
        client_user_agent: navigator.userAgent,
        fbp: this.getCookie('_fbp'),
        fbc: this.getFbc(),
        external_id: this.getOrCreateExternalId(),
      },
      telemetry: {
        load_time_ms: window.performance?.timing?.domContentLoadedEventEnd - window.performance?.timing?.navigationStart,
        screen_width: window.screen.width,
        screen_height: window.screen.height,
        // @ts-ignore
        dwell_time_ms: dwellTime,
        // @ts-ignore
        max_scroll_pct: this.maxScroll,
        // @ts-ignore
        is_final: isFinal
      }
    };

    // Adiciona dados persistidos (email, nome, etc)
    try {
      const stored = JSON.parse(localStorage.getItem('ta_user_data') || '{}');
      payload.user_data = { ...payload.user_data, ...stored };
    } catch {}

    this.send(payload);
  }

  public identify(userData: Record<string, any>) {
    try {
      const normalized = this.normalizeUserData(userData);
      const existing = JSON.parse(localStorage.getItem('ta_user_data') || '{}');
      const updated = { ...existing, ...normalized };
      localStorage.setItem('ta_user_data', JSON.stringify(updated));
    } catch (e) {
      console.error('Error saving user data', e);
    }
  }

  private normalizeUserData(data: Record<string, any>): Record<string, any> {
    const out: Record<string, any> = { ...data };

    // Nome
    if (out.name || out.nome || out.fullname || out.full_name) {
      const fullName = (out.name || out.nome || out.fullname || out.full_name || '').trim();
      if (fullName && (!out.fn || !out.ln)) {
        const parts = fullName.split(' ');
        if (parts.length > 0) {
          out.fn = parts[0];
          if (parts.length > 1) {
            out.ln = parts.slice(1).join(' ');
          }
        }
      }
    } else if (out.fn && !out.ln && out.fn.trim().includes(' ')) {
      // Fallback: se 'fn' contiver espaços e não tiver 'ln', assumir que é nome completo
      const fullName = out.fn.trim();
      const parts = fullName.split(' ');
      if (parts.length > 0) {
        out.fn = parts[0];
        if (parts.length > 1) {
          out.ln = parts.slice(1).join(' ');
        }
      }
    }

    // Telefone (apenas números)
    if (out.phone || out.telefone || out.celular || out.whatsapp) {
      const rawPhone = out.phone || out.telefone || out.celular || out.whatsapp;
      out.ph = rawPhone.replace(/\D/g, '');
    }

    // Email (lowercase)
    if (out.email || out.e_mail || out.mail) {
      const rawEmail = out.email || out.e_mail || out.mail;
      out.em = rawEmail.trim().toLowerCase();
    }
    
    return out;
  }

  private setupFormListeners() {
    // Listener de Submit
    document.addEventListener('submit', (e) => {
      const form = e.target as HTMLFormElement;
      if (!form) return;

      const data: Record<string, any> = {};
      const elements = form.elements; // HTMLFormControlsCollection

      for (let i = 0; i < elements.length; i++) {
        const element = elements[i] as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        const name = element.name;
        const value = element.value;

        if (name && value) {
          const k = name.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (['email', 'e_mail', 'mail'].includes(k)) data.email = value;
          if (['phone', 'telefone', 'celular', 'whatsapp', 'tel', 'cel'].includes(k)) data.phone = value;
          if (['name', 'nome', 'fullname', 'full_name', 'nomecompleto'].includes(k)) data.name = value;
          if (['fn', 'firstname', 'primeironome'].includes(k)) data.fn = value;
          if (['ln', 'lastname', 'sobrenome'].includes(k)) data.ln = value;
        }
      }
      
      if (!data.email) {
         const emailInput = form.querySelector('input[type="email"]');
         if (emailInput) data.email = (emailInput as HTMLInputElement).value;
      }
      if (!data.phone) {
         const telInput = form.querySelector('input[type="tel"]');
         if (telInput) data.phone = (telInput as HTMLInputElement).value;
      }

      if (Object.keys(data).length > 0) {
        this.identify(data);
      }
    }, true);

    // Listener de Blur (captura progressiva)
    document.addEventListener('blur', (e) => {
      const target = e.target as HTMLInputElement;
      if (!target || target.tagName !== 'INPUT') return;
      
      const type = target.type;
      const name = (target.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const value = target.value;
      
      if (!value) return;

      const data: Record<string, any> = {};

      if (type === 'email' || ['email', 'e_mail', 'mail'].includes(name)) {
        data.email = value;
      }
      if (type === 'tel' || ['phone', 'telefone', 'celular', 'whatsapp', 'tel'].includes(name)) {
        data.phone = value;
      }
      if (['name', 'nome', 'fullname', 'full_name'].includes(name)) {
        data.name = value;
      }
      if (['fn', 'firstname', 'primeironome'].includes(name)) {
        data.fn = value;
      }
      if (['ln', 'lastname', 'sobrenome'].includes(name)) {
        data.ln = value;
      }
      
      if (Object.keys(data).length > 0) {
        this.identify(data);
      }
    }, true);
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
 
     const beaconOk = typeof navigator.sendBeacon === 'function'
       ? navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }))
       : false;

     if (!beaconOk && typeof window.fetch === 'function') {
        fetch(url, {
          method: 'POST',
          credentials: 'omit',
          headers: {
            'Content-Type': 'text/plain'
          },
          body: body,
          keepalive: true,
          mode: 'cors'
        }).then(res => {
         if (!res.ok) console.error('[TRK] Server error:', res.status, res.statusText);
         else console.log('[TRK] Event sent successfully');
       }).catch((err) => {
         console.error('[TRK] Fetch error:', err);
       });
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
