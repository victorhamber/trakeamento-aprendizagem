# Política de retenção e otimização do banco de dados

Este documento descreve a política de retenção de dados e boas práticas para manter o armazenamento do PostgreSQL sob controle em ambiente comercial (janela analítica 30 dias, sem exigências regulatórias rígidas).

## Retenção por tabela

| Tabela | Retenção | Motivo |
|-------|----------|--------|
| **web_events** | 30 dias | Alto volume; cobre a janela analítica. |
| **capi_outbox** | 7 dias + remoção de falhas permanentes (attempts >= 5) | Fila efêmera. |
| **recommendation_reports** | Uma linha por contexto (site_key + campaign_id + date_preset) | UPSERT substitui o anterior; não há limpeza por idade. |
| **purchases** | 12 meses | Histórico comercial/financeiro (disputas, MRR). |
| **meta_insights_daily** | 90 dias | Métricas agregadas; tendências recentes. |
| **site_visitors** | 90 dias (last_seen_at) | Evita crescimento ilimitado; suficiente para atribuição. |
| **password_resets** | Remoção de tokens expirados (expires_at < NOW()) | Reduz tabela e evita reuso. |
| **notifications** | Notificações **lidas** com mais de 90 dias | Mantém inbox recente. |
| **global_notifications** | Avisos com expires_at < NOW() | Admin controla; expirados não precisam ficar. |
| Demais (accounts, users, sites, plans, integrations, etc.) | Sem retenção por tempo | Dados de configuração e identidade. |

O job de limpeza roda em `main.ts` (`runDataRetentionCleanup`) a cada 24 horas.

## Boas práticas para desenvolvimento

- **Relatórios e listagens:** Sempre filtrar por colunas indexadas (ex.: `site_key`, `event_time`, `created_at`). Evitar funções na coluna em filtros (ex.: `DATE(created_at)`).
- **Tabelas grandes:** Evitar `SELECT *`; escolher apenas as colunas necessárias.
- **Listagens:** Usar paginação (`LIMIT`/`OFFSET` ou cursor) em vez de retornar tudo.
- **Novas funcionalidades:** Se uma nova consulta frequente for introduzida em tabela grande, avaliar índice composto alinhado ao filtro/ordenação.

## recommendation_reports: apenas última análise

A tabela `recommendation_reports` mantém **uma única linha por contexto** `(site_key, campaign_id, date_preset)`. Cada nova geração de diagnóstico faz UPSERT: se já existir relatório para esse contexto, o registro é atualizado (analysis_text e created_at); caso contrário, é inserido. Não há histórico de análises antigas; isso reduz o tamanho da tabela e o armazenamento.
