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

  constructor(apiUrl: string, siteKey: string) {
    this.apiUrl = apiUrl;
    this.siteKey = siteKey;
    this.init();
  }

  private init() {
    this.trackPageView();
    this.autoTagLinks();
  }

  private getCookie(name: string): string | undefined {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop()?.split(';').shift();
  }

  private generateEventId(): string {
    return 'evt_' + Math.random().toString(36).substr(2, 9) + Date.now();
  }

  public track(eventName: string, customData?: Record<string, any>) {
    const payload: EventPayload = {
      event_name: eventName,
      event_time: Math.floor(Date.now() / 1000),
      event_id: this.generateEventId(),
      event_source_url: window.location.href,
      user_data: {
        client_user_agent: navigator.userAgent,
        fbp: this.getCookie('_fbp'),
        fbc: this.getCookie('_fbc'),
        // external_id pode vir de um cookie ou variável global se o user estiver logado
      },
      custom_data: customData,
      telemetry: {
        load_time_ms: window.performance?.timing?.domContentLoadedEventEnd - window.performance?.timing?.navigationStart,
        screen_width: window.screen.width,
        screen_height: window.screen.height
      }
    };

    this.send(payload);
  }

  private send(payload: EventPayload) {
    if (navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      navigator.sendBeacon(`${this.apiUrl}/ingest/events?key=${this.siteKey}`, blob);
    } else {
      fetch(`${this.apiUrl}/ingest/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Site-Key': this.siteKey
        },
        body: JSON.stringify(payload)
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
        const fbc = this.getCookie('_fbc');
        
        // Se o link for externo (checkout), injeta os parâmetros
        if (url.hostname !== window.location.hostname) {
          if (fbp) url.searchParams.set('fbp', fbp);
          if (fbc) url.searchParams.set('fbc', fbc);
          
          // Preserva UTMs atuais da página
          const currentUrl = new URL(window.location.href);
          ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach(utm => {
            const val = currentUrl.searchParams.get(utm);
            if (val) url.searchParams.set(utm, val);
          });

          target.href = url.toString();
        }
      }
    });
  }
}

// Inicialização automática se script configurado
if ((window as any).TRACKING_CONFIG) {
  const config = (window as any).TRACKING_CONFIG;
  (window as any).tracker = new Tracker(config.apiUrl, config.siteKey);
}
