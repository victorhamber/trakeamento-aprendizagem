import axios from 'axios';

/**
 * Resumo seguro para logs (nunca inclui access_token nem URL com segredo).
 */
export function summarizeMetaMarketingError(err: unknown): string {
  try {
    if (!axios.isAxiosError(err)) return String((err as Error)?.message || err || 'unknown error');
    const status = err.response?.status;
    const data = err.response?.data as
      | { error?: { code?: number; error_subcode?: number; message?: string; fbtrace_id?: string } }
      | undefined;
    const fb = data?.error;
    const code = fb?.code;
    const sub = fb?.error_subcode;
    const msg = fb?.message || err.message || 'Meta API error';
    const trace = fb?.fbtrace_id ? ` fbtrace=${fb.fbtrace_id}` : '';
    return `status=${status} code=${code} subcode=${sub} msg=${msg}${trace}`;
  } catch {
    return 'Meta API error';
  }
}
