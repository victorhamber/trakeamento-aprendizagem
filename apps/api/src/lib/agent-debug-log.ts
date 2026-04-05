import fs from 'fs';

/**
 * Log opcional para diagnóstico. Por padrão não faz nada (evita I/O em produção).
 * Ative com AGENT_DEBUG_LOG=1; opcionalmente AGENT_DEBUG_LOG_PATH=/caminho/arquivo.ndjson
 */
export function agentDebugLog(payload: Record<string, unknown>): void {
  if (process.env.AGENT_DEBUG_LOG !== '1') return;
  try {
    const line = JSON.stringify({ timestamp: Date.now(), ...payload }) + '\n';
    const outPath = process.env.AGENT_DEBUG_LOG_PATH?.trim();
    if (outPath) fs.appendFileSync(outPath, line);
    else console.debug('[agent-debug]', payload);
  } catch {
    /* ignore */
  }
}
