# Trakeamento - Tracking & Analytics Platform

## Overview
A web analytics and tracking platform with Meta (Facebook) CAPI integration, built as a monorepo with separate API and dashboard applications.

## Project Architecture

### Structure
- `apps/api/` - Express.js backend API (TypeScript, port 3001)
- `apps/dashboard/` - Vite + React frontend dashboard (TypeScript, port 5000)
- `apps/api/src/routes/sdk.ts` - Smart Snippet tracker (served dynamically via `/sdk/tracker.js`)
- `api/` - Legacy API code (not actively used)
- `src/` - Legacy root frontend (not actively used)
- `migrations/` - SQL migration files

### Tech Stack
- **Backend**: Node.js, Express, TypeScript, PostgreSQL (pg)
- **Frontend**: React 18, Vite 4, TailwindCSS, Axios
- **Database**: PostgreSQL (Replit built-in)
- **Auth**: JWT-based authentication

### Key Environment Variables
- `DATABASE_URL` - PostgreSQL connection string (auto-set by Replit)
- `JWT_SECRET` - JWT signing secret
- `APP_ENCRYPTION_KEY` - Encryption key for sensitive data
- `PORT` - API server port (3001)
- `META_APP_ID`, `META_APP_SECRET` - Meta/Facebook integration (optional)
- `OPENAI_API_KEY` - OpenAI integration for AI features (optional)

### Workflow
Single workflow runs both API and dashboard:
- API: `cd apps/api && PORT=3001 npx ts-node-dev --respawn src/main.ts`
- Dashboard: `cd apps/dashboard && npx vite --host 0.0.0.0 --port 5000`

### Database
PostgreSQL with tables for accounts, users, sites, web_events, purchases, meta_outbox, integrations, and AI settings. Schema is auto-created on API startup via `ensureSchema()`.

## Recent Changes
- 2026-02-16: Configured for Replit environment (vite proxy, port config, DB setup)
