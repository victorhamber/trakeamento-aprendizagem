import { appendFile } from 'fs/promises';
import path from 'path';

const SESSION_ID = '606832';
const INGEST_URL = 'http://127.0.0.1:7269/ingest/27f39761-3936-4b2f-a38d-44ac4db7d2c9';

function workspaceDebugLogPath(): string {
  // apps/api/src/lib → monorepo root
  return path.join(__dirname, '..', '..', '..', 'debug-606832.log');
}

export type AgentDebugEntry = {
  runId?: string;
  hypothesisId: string;
  location: string;
  message: string;
  data?: Record<string, unknown>;
};

/**
 * Envia para o servidor de debug (se acessível) e grava NDJSON na raiz do repo
 * para ambientes em que o fetch para 127.0.0.1 não chega ao ingest (ex.: Docker).
 */
export function agentDebugLog(entry: AgentDebugEntry): void {
  const body = {
    sessionId: SESSION_ID,
    timestamp: Date.now(),
    ...entry,
  };
  const line = `${JSON.stringify(body)}\n`;
  void appendFile(workspaceDebugLogPath(), line).catch(() => {});
  if (typeof fetch !== 'undefined') {
    void fetch(INGEST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': SESSION_ID },
      body: JSON.stringify(body),
    }).catch(() => {});
  }
}
