# 🧩 Mapeamento Técnico do Projeto

## 1) Visão Geral da Arquitetura
Arquitetura recomendada em 3 camadas:

1. **Coletor no Site (Web SDK)**
   - Script leve para capturar eventos (PageView, ViewContent, Lead, AddToCart, InitiateCheckout) + telemetria (tempo, cliques, performance).
   - Geração/propagação de `event_id` para deduplicação.

2. **Gateway/Backend (API + Jobs)**
   - Ingestão e persistência de eventos.
   - Integração com Meta CAPI.
   - Integração com Meta Marketing API (insights).
   - Webhook de compra (checkout → backend).
   - Motor de diagnóstico (regras) e geração de recomendações com LLM.

3. **Dashboard (Admin Web)**
   - Visualizar funil, performance e diagnósticos.
   - Configurar integrações (Meta, webhook) e políticas de dados.

## 2) Stack de Tecnologias (proposta)

### Backend
- **Node.js + TypeScript** com **NestJS** (módulos, DI, validação) ou alternativa equivalente.
- Banco: **PostgreSQL** (JSONB + índices) para eventos e insights.
- Fila/Jobs: **BullMQ + Redis** (sync com Meta, reprocessamento, retries).
- HTTP: REST (OpenAPI) e Webhooks.
- Autenticação: JWT para painel + chaves por site para ingestão.

### Web SDK
- JavaScript/TypeScript (bundle pequeno), envio via `sendBeacon`/`fetch` com retry básico.
- Coleta de performance via Web Performance API (ex.: Navigation Timing / PerformanceObserver).

### Dashboard
- Web app (React/Next.js ou equivalente) consumindo a API.
- Gráficos (ex.: Recharts/ECharts), tabelas e filtros.

### LLM
- Integração com **OpenAI** para geração de diagnósticos e recomendações.

## 3) Estrutura de Pastas (monorepo sugerido)

```
/apps
  /api
    /src
      /modules
        /auth
        /ingest
        /meta
        /webhooks
        /analytics
        /recommendations
      /common
      main.ts
  /dashboard
    /src
      /pages (ou /app)
      /components
      /features
      /lib
  /web-sdk
    /src
      index.ts
      events.ts
      perf.ts
      identity.ts
      transport.ts
/packages
  /shared
    /src
      types
      validators
      utils
/infra
  /migrations
  /docker
  /scripts
```

## 4) Componentes e Responsabilidades

### 4.1 Ingestão (`/modules/ingest`)
- Recebe eventos do Web SDK.
- Valida schema e assinatura (chave do site).
- Normaliza campos (ex.: `event_time`, `event_source_url`, `event_id`).
- Persiste raw payload (JSONB) e colunas indexáveis.

### 4.2 Integração Meta CAPI (`/modules/meta`)
- Monta payload CAPI com `user_data` e `custom_data`.
- Deduplicação: garante `event_id` consistente.
- Retries e DLQ (fila de falhas) para reenvio.

### 4.3 Webhooks (`/modules/webhooks`)
- Endpoint de compra autenticado (HMAC + timestamp).
- Normaliza dados do comprador (hashing SHA-256) e produtos.
- Dispara Purchase via CAPI e grava compra.

### 4.4 Insights Meta Ads (`/modules/meta` + jobs)
- Sync agendado para coletar:
  - `campaign_id`, `adset_id`, `ad_id`, `spend`, `impressions`, `clicks`, `ctr`, `cpc`, `cpm`, `actions`, `purchases` etc.
- Armazena snapshots por dia.

### 4.5 Analytics e Diagnóstico (`/modules/analytics`)
- Funis e métricas:
  - Landing → ViewContent → Lead → Checkout → Purchase.
- Segmentação por campanha/anúncio/URL/tempo.
- Heurísticas de gargalo (regra/score) para alimentar o LLM.

### 4.6 Recomendações (LLM) (`/modules/recommendations`)
- Monta contexto mínimo (sem PII em claro) e chama LLM.
- Persiste relatório, evidências e ações sugeridas.

## 5) Modelo de Dados (PostgreSQL)

### Tabelas principais
- `accounts`: clientes/organizações.
- `users`: usuários do dashboard.
- `sites`: domínios/projetos (chave de ingestão).
- `meta_connections`: tokens, pixel, configurações (armazenar token criptografado).
- `web_events`:
  - colunas: `site_id`, `event_name`, `event_time`, `event_id`, `event_source_url`, `event_url`, `page_title`, `load_time_ms`, `fbp`, `fbc`, `external_id_hash`, `ip`, `ua`, `raw_payload` (JSONB).
- `sessions` (opcional no MVP): agregação por `session_id`.
- `purchases`:
  - `order_id`, `value`, `currency`, `items` (JSONB), `buyer_hashes`, `event_time`, `raw_payload`.
- `meta_insights_daily`:
  - dimensões (campaign/adset/ad) + métricas + data.
- `recommendation_reports`:
  - `site_id`, período, summary, detalhes (JSONB), status.

### Índices essenciais
- `web_events(site_id, event_time)`
- `web_events(event_id)` (dedupe)
- `meta_insights_daily(account_id, day, campaign_id, adset_id, ad_id)`
- JSONB GIN para `raw_payload` quando necessário.

## 6) APIs Necessárias (REST)

### Ingestão (Site → Backend)
- `POST /v1/ingest/events`
  - Autenticação: `X-Site-Key` + assinatura opcional.

### Webhook (Checkout → Backend)
- `POST /v1/webhooks/purchase`
  - Autenticação: `X-Signature`, `X-Timestamp`.

### Configuração (Dashboard)
- `POST /v1/sites`
- `POST /v1/meta/connect`
- `POST /v1/meta/test-event`

### Analytics
- `GET /v1/analytics/funnel`
- `GET /v1/analytics/pages`
- `GET /v1/analytics/ads`

### Recomendações
- `POST /v1/recommendations/generate`
- `GET /v1/recommendations/reports/:id`

## 7) Segurança e Privacidade (mínimo obrigatório)
- Hashing SHA-256 para identificadores pessoais.
- Criptografia em repouso para tokens (KMS ou chave de app).
- Rate limiting na ingestão e webhook.
- Consentimento: flag por sessão/evento para bloquear envio quando não consentido.

