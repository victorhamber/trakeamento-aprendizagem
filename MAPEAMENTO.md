# 🧩 Mapeamento Técnico do Projeto

## 1) Visão Geral da Arquitetura

O projeto é um Monorepo utilizando **Workspaces** (npm/yarn/pnpm), dividido em:

*   **`apps/api`**: Backend Node.js/Express (Core do sistema).
*   **`apps/dashboard`**: Frontend React/Vite (Interface do usuário).
*   **`apps/admin`**: Frontend React/Vite (Interface administrativa).

## 2) Backend (`apps/api`)

### Estrutura de Diretórios
```
/src
  /db           -> Conexão Postgres (pool) e schemas.
  /lib          -> Utilitários (crypto, jwt).
  /middleware   -> Auth, Rate Limiting, CORS.
  /routes       -> Definição de endpoints (ingest, meta, ai, etc).
  /services     -> Lógica de negócios complexa.
  /scripts      -> Migrations e Jobs manuais.
  main.ts       -> Entry point.
```

### Serviços Principais (`/services`)

1.  **`CapiService` (`capi.ts`)**
    *   Responsável pela comunicação com Meta Conversions API.
    *   **Funcionalidades:** Normalização de PII, Hashing, Construção de Payload.
    *   **Resiliência:** Implementa padrão **Outbox** (`capi_outbox` table) para garantir entrega mesmo em falhas momentâneas.
    *   **Circuit Breaker:** Detecta tokens inválidos e pausa envios para evitar banimento.

2.  **`IngestService` (via `routes/ingest.ts`)**
    *   Endpoint de alta performance para receber eventos do Web SDK.
    *   **Deduplicação:** Verifica `event_id` em cache (LRU) e no Banco.
    *   **Enriquecimento:** Calcula `Engagement Score` baseado em telemetria.
    *   **Dispatch:** Dispara processamento assíncrono para CAPI e GA4.

3.  **`MetaMarketingService` (`meta-marketing.ts`)**
    *   Sincroniza dados da API de Marketing do Facebook.
    *   **Granularidade:** Campanhas, AdSets e Ads.
    *   **Normalização:** Transforma arrays complexos de `actions` em colunas planas (leads, purchases, cost_per_x).
    *   **Idempotência:** Remove dados do dia antes de reinserir para evitar duplicidade.

4.  **`Ga4Service` (`ga4.ts`)**
    *   Envia eventos para Google Analytics 4 via Measurement Protocol.
    *   Mapeia eventos padrão (Meta -> GA4).
    *   Gerencia `client_id` e `user_properties`.

5.  **`DiagnosisService` (`diagnosis.ts`)**
    *   Orquestrador da IA.
    *   Coleta dados de todas as fontes (DB, Meta API, Crawler de LP).
    *   Calcula heurísticas ("Sinais") para alimentar o prompt da IA.
    *   Busca criativos (imagens/textos) na API do Meta para análise qualitativa.

6.  **`LlmService` (`llm.ts`)**
    *   Cliente da OpenAI.
    *   Gerencia System Prompts e Context Windows.
    *   Valida se a resposta do GPT está completa e no formato Markdown esperado.

### Banco de Dados (PostgreSQL)

**Tabelas Chave:**
*   `web_events`: Tabela massiva com todos os eventos raw + telemetria.
*   `meta_insights_daily`: Dados agregados de performance do Meta.
*   `sites`: Configurações de cada projeto rastreado.
*   `integrations_meta`: Tokens e configs do Pixel/CAPI.
*   `recommendation_reports`: Histórico de diagnósticos gerados pela IA.
*   `capi_outbox`: Fila de retentativa de eventos CAPI.
*   `site_visitors`: Perfis unificados de visitantes (Identity Graph simples).

## 3) Frontend (`apps/dashboard`)

*   **Stack:** React, Vite, Tailwind CSS.
*   **Principais Funcionalidades:**
    *   Dashboard de Visão Geral.
    *   Configuração de Sites e Integrações.
    *   Visualização de Relatórios de IA (Markdown renderizado).
    *   Gerador de UTMs e Scripts.

## 4) Fluxo de Dados (Data Flow)

1.  **Ingestão:** Browser -> `POST /ingest/events` -> `web_events` (DB).
2.  **Processamento:** `web_events` -> `CapiService` -> Meta Graph API.
3.  **Sync:** Cron/Job -> `MetaMarketingService` -> Meta Marketing API -> `meta_insights_daily`.
4.  **Diagnóstico:** Usuário solicita -> `DiagnosisService` (agrupa dados) -> `LlmService` (OpenAI) -> Relatório.
