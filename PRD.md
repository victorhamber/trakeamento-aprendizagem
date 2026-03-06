# 🧭 Product Requirements Document (PRD)

**Nome do Projeto:**
Trakeamento e Aprendizagem (Meta Ads) — Análise, Otimização e Tracking Avançado

## 1) Objetivo Principal
Criar um sistema que consolide **performance de campanhas do Meta Ads**, **comportamento do lead no site** e **dados de compra** (via webhook), para **diagnosticar gargalos de conversão** e oferecer uma visão em tempo real da operação.

## 2) Problema e Contexto
O documento descreve como dor principal:
- Dificuldade de **otimização e análise** de campanhas no Meta Ads.
- Falta de visão integrada entre **anúncio → navegação no site → compra**.
- Necessidade de **feedback visual imediato** (dashboards) além dos relatórios de texto.
- Necessidade de **robustez técnica** (testes automatizados) para garantir a precisão dos dados financeiros/tracking.

## 3) Público-Alvo
- Gestores de tráfego e agências.
- Produtores e e-commerces que anunciam no Meta.
- Operações que usam plataformas de vendas (checkout) com capacidade de webhook.

## 4) Escopo

### 4.1 Em Escopo (Implementado)
- **Coleta de eventos e telemetria do site:**
  - `PageView`, `PageEngagement` (dwell time, scroll, clicks).
  - Cálculo de "Engagement Score".
- **Envio de eventos para o Meta (CAPI):**
  - Deduplicação robusta (Memória + Banco).
  - Outbox/Retry pattern.
  - Circuit Breaker para tokens.
- **Diagnóstico com IA (LLM):**
  - Análise automática via OpenAI (GPT-4o).
  - Leitura de Landing Page e Criativos.

### 4.2 Em Escopo (Fase Atual - Melhorias)
- **Qualidade de Software (Testes):**
  - Implementação de testes unitários e de integração para o Core (Ingestão, CAPI, Deduplicação).
  - Garantia de que atualizações não quebrem o tracking financeiro.
- **Dashboard em Tempo Real (Meta Ads):**
  - Gráficos nativos no painel (evolução de vendas, CTR, CPA).
  - Widgets de performance (Funil de Conversão visual).
  - Monitoramento de "Health" do sistema (fila de eventos, erros de API).

### 4.3 Fora de Escopo
- Integrações com Google Ads e TikTok Ads (adiado).
- Execução automática de mudanças na conta Meta.

## 5) Requisitos Funcionais

### 5.1 Tracking & Core
- Manter a estabilidade do tracking atual.
- **Novo:** Validar lógica de deduplicação e sanitização com testes automatizados.

### 5.2 Dashboard Analítico
- **Endpoint de Séries Temporais:** Fornecer dados agregados por dia/hora para gráficos.
- **Componentes Visuais:**
  - Gráfico de Linha: Spend vs. Receita (ROAS).
  - Gráfico de Barras: Funil (Clicks -> LP Views -> Checkout -> Purchase).
  - Indicadores (KPIs): Cards com comparativo vs. período anterior.

## 6) Requisitos Não Funcionais
- **Confiabilidade:** Cobertura de testes nas funções críticas de dinheiro/tracking.
- **Performance de UI:** Gráficos devem carregar em < 1s.

## 7) Métricas de Sucesso
- **Qualidade:** > 80% de cobertura de testes nos serviços críticos (`CapiService`, `IngestService`).
- **Usabilidade:** Usuário consegue ver a tendência de ROAS sem precisar gerar relatório de IA.
