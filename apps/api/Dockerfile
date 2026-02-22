FROM node:18-alpine AS builder

WORKDIR /app

# Copia package.json
COPY package*.json ./

# Instala dependências (incluindo devDependencies para build)
RUN npm install --include=dev
COPY . .

# Builda TypeScript
RUN npm run build

# --- Stage Dependências de Produção ---
FROM node:18-alpine AS deps

WORKDIR /app

COPY package*.json ./
# Instala APENAS dependências de produção (mais seguro que prune)
RUN npm install --production

# --- Stage Final ---
FROM node:18-alpine

WORKDIR /app

# Copia apenas o necessário
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./

# Variáveis de ambiente padrão
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Comando de inicialização direto (melhor para containers)
CMD ["node", "dist/main.js"]
