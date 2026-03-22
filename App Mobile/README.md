# Trajettu Mobile

App nativo (Expo) para acompanhar vendas e receber **notificações push** quando uma nova venda é registrada (webhook).

## O que o app faz

- **Login** com as mesmas credenciais do dashboard (API Trajettu).
- **Resumo do dia**: vendas de hoje e receita de hoje.
- **Últimas vendas**: lista das 15 vendas mais recentes (valor, site, data).
- **Push notifications**: quando uma compra é aprovada no webhook, o app recebe uma notificação com valor e plataforma.

O app usa a **mesma base de dados** da API (rotas `/auth`, `/dashboard/mobile-summary`, `/mobile/register-push`). É um projeto separado apenas no código (pasta e repositório à parte, se quiser).

## Configurar a API

Crie um arquivo `.env` na pasta do app (ou defina no ambiente):

```env
EXPO_PUBLIC_API_URL=https://sua-api.com
```

Exemplo para desenvolvimento local:

```env
EXPO_PUBLIC_API_URL=http://192.168.1.10:3000
```

(Use o IP da sua máquina na rede para testar no celular.)

## Rodar em desenvolvimento (Expo Go)

```bash
cd "App Mobile"
npm install
npx expo start
```

Escaneie o QR code com o app **Expo Go** no celular.

---

## Gerar app instalável (APK no Android)

Para instalar o app direto no telefone (arquivo `.apk`), use o **EAS Build** (Expo Application Services):

### 1. Conta Expo

Crie uma conta em [expo.dev](https://expo.dev) (grátis).

### 2. Instalar EAS CLI e fazer login

```bash
npm install -g eas-cli
eas login
```

### 3. Configurar o projeto (só na primeira vez)

Na pasta do app:

```bash
cd "App Mobile"
eas build:configure
```

(Use as opções padrão se aparecer alguma pergunta.)

### 4. Gerar o APK

```bash
eas build --platform android --profile preview
```

Ou use o script:

```bash
npm run build:apk
```

O build roda na nuvem. Quando terminar, aparece um **link para baixar o APK**. Abra no celular Android, baixe e instale (pode ser preciso permitir “Instalar de fontes desconhecidas” nas configurações).

- **Perfil `preview`**: gera APK para instalação direta (não precisa da Play Store).
- **Perfil `production`**: também gera APK; use se quiser depois publicar na Play Store (aí você gera AAB com outro perfil).

### 5. iOS (opcional)

Para instalar no iPhone é preciso build com EAS em um plano pago ou com Mac + Xcode. No Android o build com perfil `preview` é **grátis** na Expo.

---

## Notificações push

- No **Expo Go**, push funciona em desenvolvimento.
- Para **build de produção** (standalone), configure o projeto no [EAS](https://expo.dev) e gere os builds (Android/iOS).
- O backend já envia push via Expo Push API quando uma venda é aprovada (tabela `push_tokens` + rota `/mobile/register-push`).

## Estrutura

- `App.tsx` – telas de login e dashboard.
- `api.ts` – chamadas à API (login, mobile-summary, register-push).
- Configuração em `app.json` (Expo, permissões de notificação).
