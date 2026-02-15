FROM node:18-alpine AS builder

WORKDIR /app

# Copia package.json
COPY package*.json ./

# Instala dependências
RUN npm install

# Copia código fonte
COPY . .

# Builda TypeScript
RUN npm run build

# Remove dependências de desenvolvimento para imagem final menor
RUN npm prune --production

# --- Stage Final ---
FROM node:18-alpine

WORKDIR /app

# Copia apenas o necessário do builder
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Variáveis de ambiente padrão
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Comando de inicialização
CMD ["npm", "start"]
