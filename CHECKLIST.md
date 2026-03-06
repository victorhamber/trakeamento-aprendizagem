# 📋 Checklist de Progresso

## Fundação e Infraestrutura
- [x] Estrutura Monorepo (Apps/API + Apps/Dashboard)
- [x] Configuração TypeScript e ESLint
- [x] Banco de Dados PostgreSQL configurado
- [x] Sistema de Migrations (Scripts em `apps/api/scripts`)

## Backend Core (API)
- [x] **Ingestão de Eventos:** Endpoint `/ingest` otimizado e validado (Zod).
- [x] **Deduplicação:** Sistema híbrido (LRU Cache + Verificação DB).
- [x] **Meta CAPI:** Integração completa com tratamento de erros.
- [x] **Resiliência CAPI:** Implementação de Tabela `capi_outbox` para retries.
- [x] **GA4:** Integração Server-Side (Measurement Protocol).
- [x] **Webhook:** Recepção e processamento de compras.

## Integrações Externas
- [x] **Meta Marketing API:** Sync de métricas (Campaign/AdSet/Ad).
- [x] **Meta Creatives:** Fetch de imagens e copys dos anúncios.
- [x] **Landing Page:** Crawler básico para extrair texto da LP.
- [x] **OpenAI:** Serviço de geração de relatórios (`LlmService`).

## Inteligência e Diagnóstico
- [x] **Motor de Diagnóstico:** Agregação de dados para Snapshot.
- [x] **Cálculo de Sinais:** Heurísticas automáticas.
- [x] **Análise de Tendência:** Comparação Período Atual vs Anterior.
- [x] **Relatórios IA:** Geração e Validação de Markdown.

## Qualidade e Testes
- [x] **Configuração de Testes:** Instalar Vitest no `apps/api`.
- [x] **Testes Unitários:** Validar `IngestService` e `CapiService` (hashing/outbox).
- [ ] **Testes de Integração:** Validar fluxo completo (API -> DB).

## Frontend (Dashboard Real-time)
- [x] Autenticação e Gestão de Contas.
- [x] Configuração de Integrações.
- [x] Relatórios de Diagnóstico (Texto).
- [x] **Instalação de Gráficos:** Biblioteca Recharts configurada.
- [x] **Endpoints de Analytics:** API `/dashboard/revenue` e `/dashboard/funnel` criada.
- [x] **Widgets de Performance:** Gráficos de Receita e Funil implementados no Dashboard.

## Pendências / Melhorias Futuras
- [ ] Multi-usuário com permissões granulares (RBAC).
- [ ] Suporte a outras redes (Google Ads, TikTok Ads) - **Adiado**.
