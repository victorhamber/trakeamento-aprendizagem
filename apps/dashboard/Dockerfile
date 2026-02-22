FROM node:18-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install --include=dev

COPY . .

# Argumento para URL da API (necessário no build do Vite)
ARG VITE_API_URL
ENV VITE_API_URL=https://api.trajettu.com

RUN npm run build

# --- Stage Final ---
FROM nginx:alpine

# Copia build estático
COPY --from=builder /app/dist /usr/share/nginx/html

# Copia configuração customizada do Nginx (para SPA)
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]