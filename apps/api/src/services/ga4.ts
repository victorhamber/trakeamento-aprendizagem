import { Pool } from 'pg';
import { decryptString, encryptString } from '../lib/crypto';
import { v4 as uuidv4 } from 'uuid';

interface Ga4EventPayload {
  client_id: string;
  user_id?: string;
  timestamp_micros?: string;
  non_personalized_ads?: boolean;
  events: {
    name: string;
    params?: Record<string, any>;
  }[];
  user_properties?: Record<string, any>;
}

export class Ga4Service {
  private pool: Pool;
  private readonly GA4_COLLECT_URL = 'https://www.google-analytics.com/mp/collect';
  private readonly GA4_DEBUG_URL = 'https://www.google-analytics.com/debug/mp/collect';

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Envia um evento para o Google Analytics 4 via Measurement Protocol.
   * @param siteKey Chave do site para buscar configurações
   * @param eventName Nome do evento (ex: purchase, generate_lead)
   * @param eventData Dados do evento (value, currency, items, etc)
   * @param userData Dados do usuário (client_id, user_id, ip, user_agent)
   * @param debugMode Se true, envia para o endpoint de debug
   */
  async sendEvent(
    siteKey: string,
    eventName: string,
    eventData: Record<string, any>,
    userData: {
      client_id?: string;
      user_id?: string;
      ip_address?: string;
      user_agent?: string;
      fbp?: string;
      fbc?: string;
      external_id?: string;
    },
    debugMode = false
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // 1. Buscar configurações do GA4 para o site
      const config = await this.getGa4Config(siteKey);
      if (!config || !config.enabled || !config.measurement_id || !config.api_secret) {
        return { success: false, error: 'GA4 not configured or disabled' };
      }

      // 2. Preparar Client ID (obrigatório)
      // Se não vier do cookie (_ga), geramos um UUID v4 para não perder o evento,
      // mas o ideal é sempre usar o do cookie para manter a sessão.
      const clientId = userData.client_id || uuidv4();

      // 3. Normalizar parâmetros do evento
      const params: Record<string, any> = {
        ...this.normalizeParams(eventData),
        engagement_time_msec: eventData.engagement_time_msec || 100, // Default para garantir sessão
        session_id: eventData.session_id, // Se disponível
        ip_override: userData.ip_address, // Suporte a IP override (requer api_secret)
        user_agent: userData.user_agent,  // Suporte a UA override (requer api_secret)
      };

      // Adicionar parâmetros de origem se disponíveis (UTMs)
      if (eventData.traffic_source) {
        params.campaign = eventData.traffic_source.campaign;
        params.source = eventData.traffic_source.source;
        params.medium = eventData.traffic_source.medium;
        params.term = eventData.traffic_source.term;
        params.content = eventData.traffic_source.content;
      }

      // 4. Montar Payload
      const payload: Ga4EventPayload = {
        client_id: clientId,
        user_id: userData.user_id, // Opcional, para User-ID feature
        non_personalized_ads: false,
        events: [
          {
            name: this.normalizeEventName(eventName),
            params: params,
          },
        ],
        user_properties: this.buildUserProperties(userData),
      };

      // 5. Enviar para o Google
      const url = debugMode ? this.GA4_DEBUG_URL : this.GA4_COLLECT_URL;
      const response = await fetch(`${url}?measurement_id=${config.measurement_id}&api_secret=${config.api_secret}`, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[GA4] Error sending event: ${response.status} ${response.statusText}`, errorText);
        return { success: false, error: `HTTP ${response.status}: ${errorText}` };
      }

      // No modo debug, o Google retorna detalhes da validação
      if (debugMode) {
        const debugResult = await response.json();
        console.log('[GA4] Debug result:', JSON.stringify(debugResult, null, 2));
      }

      return { success: true };

    } catch (error: any) {
      console.error('[GA4] Exception sending event:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Busca as credenciais do GA4 no banco de dados
   */
  private async getGa4Config(siteKey: string) {
    const query = `
      SELECT ga.measurement_id, ga.api_secret_enc, ga.enabled
      FROM integrations_ga ga
      JOIN sites s ON ga.site_id = s.id
      WHERE s.site_key = $1
    `;
    
    const result = await this.pool.query(query, [siteKey]);
    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    if (!row.api_secret_enc) return null;

    try {
      const apiSecret = decryptString(row.api_secret_enc);
      return {
        measurement_id: row.measurement_id,
        api_secret: apiSecret,
        enabled: row.enabled,
      };
    } catch (e) {
      console.error('[GA4] Error decrypting API secret', e);
      return null;
    }
  }

  /**
   * Normaliza nomes de eventos para o padrão GA4 (snake_case)
   */
  private normalizeEventName(name: string): string {
    // Mapeamento de eventos padrão do Meta/Facebook para GA4
    const map: Record<string, string> = {
      'PageView': 'page_view',
      'ViewContent': 'view_item',
      'AddToCart': 'add_to_cart',
      'InitiateCheckout': 'begin_checkout',
      'Purchase': 'purchase',
      'Lead': 'generate_lead',
      'Contact': 'contact',
      'Search': 'search',
      'CompleteRegistration': 'sign_up',
    };

    return map[name] || name.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
  }

  /**
   * Filtra e formata parâmetros para garantir tipos aceitos pelo GA4
   */
  private normalizeParams(data: Record<string, any>): Record<string, any> {
    const out: Record<string, any> = {};
    
    // Lista de chaves a ignorar (PII ou dados internos)
    const ignore = ['user_data', 'custom_data', 'telemetry', 'fbp', 'fbc', 'external_id'];

    for (const [key, value] of Object.entries(data)) {
      if (ignore.includes(key)) continue;
      
      // GA4 aceita string ou number. Boolean vira string.
      if (typeof value === 'boolean') {
        out[key] = value ? 'true' : 'false';
      } else if (typeof value === 'object' && value !== null) {
        // Se for objeto (ex: items), tentar serializar ou extrair
        if (key === 'items' && Array.isArray(value)) {
          out.items = value.map(this.normalizeItem);
        } else {
          // Flatten simples ou ignorar
          out[key] = JSON.stringify(value).substring(0, 100); // Limite de chars
        }
      } else {
        out[key] = value;
      }
    }

    // Mapeamento específico de parâmetros de e-commerce
    if (data.value) out.value = Number(data.value);
    if (data.currency) out.currency = String(data.currency).toUpperCase();
    if (data.transaction_id || data.order_id) out.transaction_id = String(data.transaction_id || data.order_id);

    return out;
  }

  private normalizeItem(item: any) {
    return {
      item_id: item.item_id || item.id,
      item_name: item.item_name || item.name,
      price: Number(item.price || 0),
      quantity: Number(item.quantity || 1),
      item_category: item.category,
      item_brand: item.brand,
    };
  }

  private buildUserProperties(userData: any): Record<string, any> {
    const props: Record<string, any> = {};
    
    // Enviar dados de identificação como User Properties para criar audiências
    if (userData.fbp) props.fbp = { value: userData.fbp };
    if (userData.fbc) props.fbc = { value: userData.fbc };
    if (userData.external_id) props.external_id_hash = { value: userData.external_id };
    
    // Tipo de Cliente (ex: se tiver user_id é logado)
    props.customer_type = { value: userData.user_id ? 'logged_in' : 'guest' };

    return props;
  }
}
