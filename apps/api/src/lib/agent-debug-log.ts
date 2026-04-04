import fs from 'fs';
import path from 'path';

/** NDJSON debug log for session e9146a — workspace root (monorepo). */
const DEBUG_LOG = path.resolve(__dirname, '..', '..', '..', '..', 'debug-e9146a.log');

export function agentDebugLog(payload: Record<string, unknown>): void {
  try {
    fs.appendFileSync(
      DEBUG_LOG,
      `${JSON.stringify({ sessionId: 'e9146a', timestamp: Date.now(), ...payload })}\n`
    );
  } catch {
    /* ignore */
  }
}
