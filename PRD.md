# 🧭 Product Requirements Document (PRD)

**Nome do Projeto:**
Trakeamento e Aprendizagem (Meta Ads) — Análise, Otimização e Tracking Avançado

## 1) Objetivo Principal
Criar um sistema que consolide **performance de campanhas do Meta Ads**, **comportamento do lead no site** e **dados de compra** (via webhook), para **diagnosticar gargalos de conversão** (oferta/página/criativo/tracking) e **gerar recomendações de otimização** usando um agente com API do GPT.

## 2) Problema e Contexto
O documento descreve como dor principal:
- Dificuldade de **otimização e análise** de campanhas no Meta Ads.
- Falta de visão integrada entre **anúncio → navegação no site → compra**.
- Necessidade de **tracking avançado** (web + server/CAPI) para melhorar aprendizado do Meta e atribuição.

## 3) Público-Alvo
- Gestores de tráfego e agências.
- Produtores e e-commerces que anunciam no Meta.
- Operações que usam plataformas de vendas (checkout) com capacidade de webhook.

## 4) Escopo

### 4.1 Em Escopo (MVP)
- Coleta de eventos e telemetria do site:
  - Tempo na página (dwell time), profundidade/engajamento básico, cliques relevantes.
  - Tempo de carregamento (ex.: LCP/TTFB/Load time), URL e título.
  - Identificadores de evento e navegador (ex.: `event_id`, `fbp`, `fbc`, `external_id` quando disponível).
- Envio de eventos para o Meta:
  - Eventos via Pixel (browser) e via **Conversions API (server)** com **deduplicação** por `event_id`.
- Integração Google Analytics 4 (GA4):
  - Coleta de dados via Measurement Protocol (server-side) para contornar bloqueadores.
  - Extração de relatórios via Analytics Data API para enriquecimento de análise (origem orgânica, tecnologia, engajamento).
- Webhook de compra:
  - Endpoint para receber dados do comprador (plataforma de vendas) e repassar como evento (ex.: Purchase) ao Meta.
- Consolidação e análise:
  - Unificação de dados: performance do anúncio + comportamento no site + compra.
  - Identificação de gargalo provável (ex.: criativo, oferta, página, velocidade, tracking).
- Recomendações com LLM:
  - Geração de diagnóstico e plano de ação com base nos dados coletados.

### 4.2 Fora de Escopo (por enquanto)
- Execução automática de mudanças na conta Meta (alterar orçamento/criativos) sem aprovação humana.
- Multi-touch attribution completo (modelo avançado) e MMM.
- Suporte a múltiplas redes além do Meta (Google/TikTok).

## 5) Requisitos Funcionais

### 5.1 Tracking Web (Site)
- Registrar eventos e metadados mínimos por sessão/usuário:
  - `event_source_url`, `event_url`, `page_title`, `load_time`, `client_user_agent`, `client_ip_address` (com cuidado de privacidade).
  - Cookies Meta: `fbp` e `fbc`.
  - `event_time` e `event_id` (gerado no cliente e reutilizado no server para dedupe).
- Capturar comportamento:
  - Tempo de permanência, cliques em CTAs, navegação entre páginas (pageview).

### 5.2 Tracking Server (Meta CAPI)
- Enviar eventos server-side para o Meta com:
  - `event_name`, `event_time`, `event_id`, `event_source_url`.
  - `user_data`: `client_ip_address`, `client_user_agent`, `external_id` (hash), `fbp`, `fbc`.
  - `custom_data`: `content_type`, itens/valor/moeda quando aplicável.
- Duplicação:
  - Garantir deduplicação Pixel + CAPI usando o mesmo `event_id`.

### 5.3 Webhook de Compras
- Disponibilizar webhook autenticado (assinatura/segredo) para a plataforma de vendas.
- Receber payload de compra e:
  - Normalizar dados essenciais (email/telefone hash, valor, moeda, produtos).
  - Extrair UTMs e tokens de rastreamento (`trk_`) mesmo de estruturas aninhadas (ex: `purchase.origin`).
  - Disparar evento Purchase via CAPI **apenas para compras aprovadas** (status `approved`, `paid`, etc).
  - Compras pendentes (ex: `BILLET_PRINTED`) são salvas no banco para histórico, mas não disparam Purchase.
  - Exibir payload enriquecido com debug visual do CAPI no painel para auditoria.
- Registrar a compra no banco para correlação com sessões/campanhas.

### 5.4 Coleta de Performance do Meta Ads
- Conectar a conta Meta (token) e buscar métricas por:
  - Campanha / conjunto / anúncio com drilldown.
  - Períodos diários e janelas configuráveis (hoje, ontem, últimos 7/14/30, máximo, personalizado).
- Armazenar snapshots para análise histórica.
- Exibir métricas de funil e eficiência:
  - Alcance, Impressões, Cliques, CTR.
  - LP Views, Taxa LP View, Custo por LP View.
  - CPC, CPM, Frequência, Hook Rate (3s ÷ impressões).
- Resultados por objetivo (leads, compras, finalizações, eventos personalizados).
- Operação de status em cada nível (campanha, conjunto, anúncio) com atualização em tempo real.

### 5.6 Integração Google Analytics 4 (GA4)
- **Measurement Protocol (Server-Side)**:
  - Enviar eventos de conversão (Purchase, Lead) e engajamento (PageEngagement) via API do Google.
  - Mitigar perda de dados causada por AdBlockers e navegadores com restrição de privacidade.
  - Garantir consistência de `client_id` (cookies) e `user_id` (login).
- **Analytics Data API (Reporting)**:
  - Extrair métricas agregadas diárias para o dashboard.
  - Dimensões: Origem/Mídia (orgânico vs pago), Categoria de Dispositivo, País/Cidade.
  - Métricas: Sessões, Usuários Ativos, Tempo de Engajamento Médio.
- **Cruzamento de Dados**:
  - Comparar dados do Meta Ads com GA4 para validar atribuição e identificar discrepâncias.

### 5.7 Gestão de Eventos e Formulários
- **Regras de Eventos por URL**:
  - Permitir configurar disparos automáticos de eventos (Standard ou Custom) baseados em correspondência de URL (ex: URL contém "/obrigado").
  - Execução no client-side via Web SDK.
- **Gerador de Formulário de Captura**:
  - Interface no painel para criar formulários HTML (Nome, Email, Telefone).
  - Personalização de texto do botão e tipo de evento (Lead, Contact, Purchase, etc).
  - Geração de código pronto para cópia, integrado ao Web SDK (`tracker.identify` + `tracker.track`).

### 5.5 Diagnóstico e Recomendações (Agente GPT)
- Gerar relatório de análise baseado em:
  - Queda de CTR → hipótese criativo/segmentação.
  - CTR ok mas baixa taxa de conversão → hipótese página/oferta.
  - Conversão ruim com load time alto → hipótese performance técnica.
  - Divergência de eventos (pixel vs server) → hipótese tracking/dedupe.
- Entregar recomendações acionáveis:
  - Lista priorizada, impacto esperado, risco, e evidências.

## 6) Requisitos Não Funcionais
- Segurança:
  - Segredos nunca no código; armazenar via configuração segura.
  - Webhook com assinatura e proteção contra replay.
  - Sanitização e validação de entrada.
- Privacidade e conformidade:
  - Minimização de dados; hashing (SHA-256) de identificadores pessoais.
  - Possibilidade de respeitar consentimento (LGPD) e opt-out.
- Performance:
  - Overhead mínimo no site (scripts leves e envio assíncrono).
- Observabilidade:
  - Auditoria de eventos enviados e falhas de integração.
- Escalabilidade:
  - Ingestão de eventos em volume com armazenamento eficiente.

## 7) Restrições Técnicas e Premissas
- O documento menciona explicitamente o uso de um **agente estilo ChatGPT via API do GPT**.
- Tracking deve cobrir **web** e **server (CAPI)** e incluir webhook de compra.
- Parametrização ampla dos eventos (exemplos: IP, UA, fbp/fbc, load time, event_id).

## 8) Dependências e Credenciais Necessárias
- Meta:
  - `PIXEL_ID`, `CAPI_ACCESS_TOKEN` (ou token do sistema), App/Business configurados.
- LLM:
  - `OPENAI_API_KEY` (atualmente não configurada no ambiente).
- Webhook da plataforma:
  - Segredo de assinatura (ex.: HMAC) e IP allowlist opcional.

## 9) Métricas de Sucesso
- Tracking:
  - Taxa de entrega de eventos > 99% (server-side) e dedupe consistente.
  - Aumento de match quality (ex.: maior uso de `fbp/fbc/external_id`).
- Análise:
  - Relatórios gerados sem erro e com recomendações acionáveis.
- Operação:
  - Erros críticos = 0 em produção; latência de ingestão aceitável.
  - Métricas de funil exibidas com consistência entre Meta e painel.

## 10) Riscos Conhecidos
- Restrições e mudanças do Meta (CAPI/Marketing API) e requisitos de permissões.
- LGPD/consentimento e tratamento de dados pessoais.
- Correlação imperfeita entre sessão do site e compra (falta de IDs consistentes).

## 11) Fluxo do Usuário (Journeys)

### 11.1 Onboarding (Administrador)
- Cria uma conta/organização no dashboard.
- Cadastra um `site` (domínio) e obtém uma `site_key`.
- Instala o Web SDK no site e valida eventos de teste.

### 11.2 Conectar Meta (Tráfego)
- Informa `PIXEL_ID` e autoriza conexão (token) para:
  - Envio CAPI.
  - Leitura de insights (Marketing API).
- Executa um “teste de evento” e confirma deduplicação (browser + server) por `event_id`.

### 11.3 Conectar Checkout (Operação)
- Configura o webhook na plataforma de vendas apontando para o endpoint do sistema.
- Realiza compra de teste e confirma:
  - Registro interno da compra.
  - Disparo de Purchase via CAPI.

### 11.4 Analisar e Otimizar (Diário)
- Acessa painel de funil e performance (por campanha/ad/anúncio e por página).
- Gera relatório do agente (LLM) para um período.
- Aplica recomendações manualmente (criativo/oferta/página/tracking) e acompanha evolução.

## 12) Critérios de Aceitação (Definition of Done)

### 12.1 Tracking e Dados
- Eventos web são registrados com `event_time`, `event_source_url`, `event_id` e identificadores Meta (`fbp/fbc`) quando disponíveis.
- Purchase recebido via webhook gera evento server-side correspondente no Meta.
- Deduplicação Pixel + CAPI funciona (mesmo `event_id`) e não duplica Purchase.

### 12.2 Integrações
- Sync de insights do Meta retorna métricas por campanha/adset/ad e persiste histórico diário.
- Falhas temporárias em APIs externas são reprocessadas (retry) e auditáveis.

### 12.3 Diagnóstico e Recomendações
- Relatório identifica pelo menos 1 gargalo provável com evidências (métrica/segmento) e ações sugeridas.
- Nenhuma PII é enviada ao LLM em texto puro (somente hashes/estatísticas agregadas).

### 12.4 Segurança/Privacidade
- Webhook exige assinatura válida e rejeita requisições inválidas.
- Segredos ficam fora do repositório e são configuráveis.

### 12.5 Qualidade
- Painel/dados não exibem erros críticos; latência de ingestão aceitável para uso operacional.

## 13) Milestones do Projeto

### Marco 1 — Fundação (1–2 semanas)
- Repositório, CI básico, banco PostgreSQL e migrations.
- Ingestão MVP (`POST /ingest/events`) + armazenamento.

### Marco 2 — Tracking Avançado (1–2 semanas)
- Web SDK com PageView + telemetria + `event_id`.
- Envio CAPI com dedupe e auditoria.

### Marco 3 — Compras e Atribuição Operacional (1–2 semanas)
- Webhook de compra (assinatura) + Purchase via CAPI.
- Correlacionar compra com eventos do site quando possível (por IDs/hash + janelas temporais).

### Marco 4 — Insights Meta Ads (1–2 semanas)
- Conexão Meta e sync diário de métricas.
- Tabelas e endpoints de analytics por campanha/anúncio.

### Marco 5 — Dashboard MVP (2–3 semanas)
- Funil, páginas, anúncios; filtros por período.
- Health do tracking (entrega, dedupe, gaps).

### Marco 6 — Agente GPT e Recomendações (1–2 semanas)
- Prompting com contexto estruturado + geração de relatório.
- Histórico de relatórios e status (novo/implementado/descartado).

### Marco 7 — Hardening e Beta (1–2 semanas)
- Performance, segurança, privacidade (LGPD/consentimento) e testes de integração.
- Pilot com 1–3 sites e ajuste de heurísticas.
