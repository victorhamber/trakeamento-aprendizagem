# 🚀 Guia de Deploy no Easypanel

Este guia explica como colocar o **Trakeamento e Aprendizagem** no ar usando sua infraestrutura Easypanel.

## 1. Preparação
O código já foi enviado para o repositório: **[https://github.com/victorhamber/trakeamento-aprendizagem](https://github.com/victorhamber/trakeamento-aprendizagem)**.
Certifique-se de que o Easypanel tenha acesso a este repositório (se for privado, você precisará conectar sua conta GitHub no Easypanel).

## 2. Criar o Banco de Dados (PostgreSQL)
1. No seu Projeto no Easypanel, clique em **+ Novo** -> **Serviço** -> **PostgreSQL**.
2. Nomeie como `tracking-db`.
3. Após criar, vá em **Conexão** e copie a "Internal Connection String" (algo como `postgres://postgres:senha@tracking-db:5432/tracking_db`).
   - Guarde essa URL, ela será usada na API.

## 3. Deploy da API (Backend)
1. Clique em **+ Novo** -> **App**.
2. Nomeie como `tracking-api`.
3. **Fonte (Source)**:
   - Conecte seu repositório Git.
   - **Branch**: main.
   - **Root Directory**: `/apps/api`.
   - **URL do Repositório**: `https://github.com/victorhamber/trakeamento-aprendizagem` (caso precise manual).
4. **Build**:
   - Tipo: Dockerfile.
   - Dockerfile Path: `Dockerfile` (já estará na raiz do contexto `/apps/api`).
5. **Variáveis de Ambiente (Environment)**:
   Adicione as seguintes chaves:
   - `PORT`: `3001`
   - `DATABASE_URL`: (Cole a URL do banco que copiou no passo 2)
   - `META_APP_ID`: (Seu ID do App Meta)
   - `META_APP_SECRET`: (Seu Segredo do App Meta)
   - `JWT_SECRET`: (Crie uma senha forte e aleatória)
   - `OPENAI_API_KEY`: (Sua chave da OpenAI, opcional se não usar IA agora)
6. Clique em **Criar / Deploy**.
7. Após o deploy, vá em **Domínios** e ative um domínio (ex: `api.seudominio.com`).
   - Copie essa URL (com https), você precisará dela no Dashboard.

## 4. Deploy do Dashboard (Frontend)
1. Clique em **+ Novo** -> **App**.
2. Nomeie como `tracking-dashboard`.
3. **Fonte (Source)**:
   - Conecte o mesmo repositório.
   - **Root Directory**: `/apps/dashboard`.
4. **Build**:
   - Tipo: Dockerfile.
   - **Build Arguments** (Aba Build -> Args):
     - Chave: `VITE_API_URL`
     - Valor: `https://api.seudominio.com` (A URL que você configurou no passo 3.7).
     - *Nota: Sem isso, o painel não conseguirá falar com a API.*
5. **Variáveis de Ambiente**:
   - Não são necessárias para rodar, pois o React é estático. A configuração é feita no Build Argument acima.
6. Clique em **Criar / Deploy**.
7. Configure o domínio (ex: `app.seudominio.com`).

## 5. Verificação
1. Acesse `app.seudominio.com`.
2. Tente fazer login (se for o primeiro acesso, o banco estará vazio, você precisará criar uma conta via API ou habilitar registro).
   - *Dica*: O sistema cria tabelas automaticamente ao iniciar.

## Solução de Problemas
- **Erro de Conexão com Banco**: Verifique se `DATABASE_URL` está correta na API.
- **Painel não carrega dados**: Abra o Console do Navegador (F12) e veja se há erros de conexão com `api.seudominio.com`. Verifique se `VITE_API_URL` foi configurada corretamente no **Build Argument** (e não apenas env var de runtime). Se mudar, precisa fazer "Rebuild".
3. **Fonte (Source)**:
   - Conecte o mesmo repositório.
   - **Root Directory**: `/apps/dashboard`.
4. **Build**:
   - Tipo: Dockerfile.
   - **Build Arguments** (Aba Build -> Args):
     - Chave: `VITE_API_URL`
     - Valor: `https://api.seudominio.com` (A URL que você configurou no passo 3.7).
     - *Nota: Sem isso, o painel não conseguirá falar com a API.*
5. **Variáveis de Ambiente**:
   - Não são necessárias para rodar, pois o React é estático. A configuração é feita no Build Argument acima.
6. Clique em **Criar / Deploy**.
7. Configure o domínio (ex: `app.seudominio.com`).

## 5. Verificação
1. Acesse `app.seudominio.com`.
2. Tente fazer login (se for o primeiro acesso, o banco estará vazio, você precisará criar uma conta via API ou habilitar registro).
   - *Dica*: O sistema cria tabelas automaticamente ao iniciar.

## Solução de Problemas
- **Erro de Conexão com Banco**: Verifique se `DATABASE_URL` está correta na API.
- **Painel não carrega dados**: Abra o Console do Navegador (F12) e veja se há erros de conexão com `api.seudominio.com`. Verifique se `VITE_API_URL` foi configurada corretamente no **Build Argument** (e não apenas env var de runtime). Se mudar, precisa fazer "Rebuild".
# 🚀 Guia de Deploy no Easypanel

Este guia explica como colocar o **Trakeamento e Aprendizagem** no ar usando sua infraestrutura Easypanel.

## 1. Preparação
Certifique-se de que este código esteja em um repositório Git (GitHub, GitLab, etc) acessível ao seu Easypanel.

## 2. Criar o Banco de Dados (PostgreSQL)
1. No seu Projeto no Easypanel, clique em **+ Novo** -> **Serviço** -> **PostgreSQL**.
2. Nomeie como `tracking-db`.
3. Após criar, vá em **Conexão** e copie a "Internal Connection String" (algo como `postgres://postgres:senha@tracking-db:5432/tracking_db`).
   - Guarde essa URL, ela será usada na API.

## 3. Deploy da API (Backend)
1. Clique em **+ Novo** -> **App**.
2. Nomeie como `tracking-api`.
3. **Fonte (Source)**:
   - Conecte seu repositório Git.
   - **Branch**: main (ou a que estiver usando).
   - **Root Directory**: `/apps/api` (Importante: define onde está o Dockerfile).
4. **Build**:
   - Tipo: Dockerfile.
   - Dockerfile Path: `Dockerfile` (já estará na raiz do contexto `/apps/api`).
5. **Variáveis de Ambiente (Environment)**:
   Adicione as seguintes chaves:
   - `PORT`: `3001`
   - `DATABASE_URL`: (Cole a URL do banco que copiou no passo 2)
   - `META_APP_ID`: (Seu ID do App Meta)
   - `META_APP_SECRET`: (Seu Segredo do App Meta)
   - `JWT_SECRET`: (Crie uma senha forte e aleatória)
   - `OPENAI_API_KEY`: (Sua chave da OpenAI, opcional se não usar IA agora)
6. Clique em **Criar / Deploy**.
7. Após o deploy, vá em **Domínios** e ative um domínio (ex: `api.seudominio.com`).
   - Copie essa URL (com https), você precisará dela no Dashboard.

## 4. Deploy do Dashboard (Frontend)
1. Clique em **+ Novo** -> **App**.
2. Nomeie como `tracking-dashboard`.
3. **Fonte (Source)**:
   - Conecte o mesmo repositório.
   - **Root Directory**: `/apps/dashboard`.
4. **Build**:
   - Tipo: Dockerfile.
   - **Build Arguments** (Aba Build -> Args):
     - Chave: `VITE_API_URL`
     - Valor: `https://api.seudominio.com` (A URL que você configurou no passo 3.7).
     - *Nota: Sem isso, o painel não conseguirá falar com a API.*
5. **Variáveis de Ambiente**:
   - Não são necessárias para rodar, pois o React é estático. A configuração é feita no Build Argument acima.
6. Clique em **Criar / Deploy**.
7. Configure o domínio (ex: `app.seudominio.com`).

## 5. Verificação
1. Acesse `app.seudominio.com`.
2. Tente fazer login (se for o primeiro acesso, o banco estará vazio, você precisará criar uma conta via API ou habilitar registro).
   - *Dica*: O sistema cria tabelas automaticamente ao iniciar.

## Solução de Problemas
- **Erro de Conexão com Banco**: Verifique se `DATABASE_URL` está correta na API.
- **Painel não carrega dados**: Abra o Console do Navegador (F12) e veja se há erros de conexão com `api.seudominio.com`. Verifique se `VITE_API_URL` foi configurada corretamente no **Build Argument** (e não apenas env var de runtime). Se mudar, precisa fazer "Rebuild".
# 🚀 Guia de Deploy no Easypanel

Este guia explica como colocar o **Trakeamento e Aprendizagem** no ar usando sua infraestrutura Easypanel.

## 1. Preparação
Certifique-se de que este código esteja em um repositório Git (GitHub, GitLab, etc) acessível ao seu Easypanel.

## 2. Criar o Banco de Dados (PostgreSQL)
1. No seu Projeto no Easypanel, clique em **+ Novo** -> **Serviço** -> **PostgreSQL**.
2. Nomeie como `tracking-db`.
3. Após criar, vá em **Conexão** e copie a "Internal Connection String" (algo como `postgres://postgres:senha@tracking-db:5432/tracking_db`).
   - Guarde essa URL, ela será usada na API.

## 3. Deploy da API (Backend)
1. Clique em **+ Novo** -> **App**.
2. Nomeie como `tracking-api`.
3. **Fonte (Source)**:
   - Conecte seu repositório Git.
   - **Branch**: main (ou a que estiver usando).
   - **Root Directory**: `/apps/api` (Importante: define onde está o Dockerfile).
4. **Build**:
   - Tipo: Dockerfile.
   - Dockerfile Path: `Dockerfile` (já estará na raiz do contexto `/apps/api`).
5. **Variáveis de Ambiente (Environment)**:
   Adicione as seguintes chaves:
   - `PORT`: `3001`
   - `DATABASE_URL`: (Cole a URL do banco que copiou no passo 2)
   - `META_APP_ID`: (Seu ID do App Meta)
   - `META_APP_SECRET`: (Seu Segredo do App Meta)
   - `JWT_SECRET`: (Crie uma senha forte e aleatória)
   - `OPENAI_API_KEY`: (Sua chave da OpenAI, opcional se não usar IA agora)
6. Clique em **Criar / Deploy**.
7. Após o deploy, vá em **Domínios** e ative um domínio (ex: `api.seudominio.com`).
   - Copie essa URL (com https), você precisará dela no Dashboard.

## 4. Deploy do Dashboard (Frontend)
1. Clique em **+ Novo** -> **App**.
2. Nomeie como `tracking-dashboard`.
3. **Fonte (Source)**:
   - Conecte o mesmo repositório.
   - **Root Directory**: `/apps/dashboard`.
4. **Build**:
   - Tipo: Dockerfile.
   - **Build Arguments** (Aba Build -> Args):
     - Chave: `VITE_API_URL`
     - Valor: `https://api.seudominio.com` (A URL que você configurou no passo 3.7).
     - *Nota: Sem isso, o painel não conseguirá falar com a API.*
5. **Variáveis de Ambiente**:
   - Não são necessárias para rodar, pois o React é estático. A configuração é feita no Build Argument acima.
6. Clique em **Criar / Deploy**.
7. Configure o domínio (ex: `app.seudominio.com`).

## 5. Verificação
1. Acesse `app.seudominio.com`.
2. Tente fazer login (se for o primeiro acesso, o banco estará vazio, você precisará criar uma conta via API ou habilitar registro).
   - *Dica*: O sistema cria tabelas automaticamente ao iniciar.

## Solução de Problemas
- **Erro de Conexão com Banco**: Verifique se `DATABASE_URL` está correta na API.
- **Painel não carrega dados**: Abra o Console do Navegador (F12) e veja se há erros de conexão com `api.seudominio.com`. Verifique se `VITE_API_URL` foi configurada corretamente no **Build Argument** (e não apenas env var de runtime). Se mudar, precisa fazer "Rebuild".