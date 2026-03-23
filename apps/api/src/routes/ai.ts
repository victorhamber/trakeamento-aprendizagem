import { Router } from 'express';
import axios from 'axios';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { decryptString, encryptString } from '../lib/crypto';

const router = Router();

const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models';

/**
 * Modelos que o LlmService consegue usar para análise (texto: chat/completions, Responses ou o-series).
 * Exclui áudio, embeddings, imagem, moderador, search-only, realtime, etc.
 */
function isAnalysisLlmModel(id: string): boolean {
  const low = id.toLowerCase().trim();

  if (
    /embedding|text-embedding|whisper|dall-e|moderation|davinci|babbage|curie|ada|omni-moderation|gpt-image|sora|clip|search-api|computer-use|evals-/.test(
      low,
    )
  ) {
    return false;
  }

  if (
    /audio|transcrib|tts|text-to-speech|speech|voice|sound|realtime|live-preview|live\b|playground|instrument|music|stt\b|asr\b|mini-tts|-tts-|_tts|-audio|-stt|search-preview|mini-transcribe|transcribe-diarize/.test(
      low,
    )
  ) {
    return false;
  }

  if (/instruct$/.test(low) && id.startsWith('gpt')) return false;

  if (id.startsWith('gpt-')) return true;
  if (id.startsWith('chatgpt-')) return true;
  if (/^o[0-9]/.test(id.trim())) return true;
  if (id.startsWith('ft:') && /gpt|o[0-9]/i.test(id)) return true;

  return false;
}

async function listOpenAiModelIds(apiKey: string): Promise<string[]> {
  const res = await axios.get<{ data?: { id: string }[] }>(OPENAI_MODELS_URL, {
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    timeout: 30_000,
  });
  const rows = Array.isArray(res.data?.data) ? res.data.data : [];
  const ids = rows.map((r) => r.id).filter((id) => typeof id === 'string' && isAnalysisLlmModel(id));
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

router.get('/settings', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const result = await pool.query(
    `SELECT openai_model, (openai_api_key_enc IS NOT NULL) as has_key
     FROM account_settings WHERE account_id = $1`,
    [auth.accountId]
  );
  const row = result.rows[0];
  const hasEnvKey = !!process.env.OPENAI_API_KEY;
  return res.json({
    has_openai_key: (row?.has_key || hasEnvKey),
    openai_model: row?.openai_model || 'gpt-4o',
    using_env_key: hasEnvKey && !row?.has_key
  });
});

router.put('/settings', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const { openai_api_key, openai_model } = req.body || {};

  const keyEnc =
    typeof openai_api_key === 'string' && openai_api_key.trim() ? encryptString(openai_api_key.trim()) : null;
  const model = typeof openai_model === 'string' && openai_model.trim() ? openai_model.trim() : null;

  await pool.query(
    `INSERT INTO account_settings (account_id, openai_api_key_enc, openai_model)
     VALUES ($1, $2, $3)
     ON CONFLICT (account_id) DO UPDATE SET
       openai_api_key_enc = CASE WHEN EXCLUDED.openai_api_key_enc IS NULL THEN account_settings.openai_api_key_enc ELSE EXCLUDED.openai_api_key_enc END,
       openai_model = COALESCE(EXCLUDED.openai_model, account_settings.openai_model),
       updated_at = NOW()`,
    [auth.accountId, keyEnc, model]
  );

  return res.json({ ok: true });
});

router.delete('/settings/openai_key', requireAuth, async (req, res) => {
  const auth = req.auth!;
  await pool.query('UPDATE account_settings SET openai_api_key_enc = NULL, updated_at = NOW() WHERE account_id = $1', [
    auth.accountId,
  ]);
  return res.json({ ok: true });
});

/** Lista modelos da conta OpenAI (GET /v1/models). Body opcional: { openai_api_key } para testar chave ainda não salva. */
router.post('/openai-models', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const bodyKey = typeof req.body?.openai_api_key === 'string' ? req.body.openai_api_key.trim() : '';

  let apiKey: string | null = bodyKey || null;
  if (!apiKey) {
    const result = await pool.query(
      `SELECT openai_api_key_enc FROM account_settings WHERE account_id = $1`,
      [auth.accountId],
    );
    const enc = result.rows[0]?.openai_api_key_enc as string | undefined;
    if (enc) {
      try {
        apiKey = decryptString(enc);
      } catch {
        return res.status(500).json({ error: 'Falha ao ler a chave salva.', models: [] });
      }
    }
  }
  if (!apiKey && process.env.OPENAI_API_KEY) {
    apiKey = process.env.OPENAI_API_KEY.trim();
  }
  if (!apiKey) {
    return res.status(400).json({
      error: 'Nenhuma chave OpenAI. Cole a chave abaixo ou salve antes de listar os modelos.',
      models: [] as string[],
    });
  }

  try {
    const models = await listOpenAiModelIds(apiKey);
    return res.json({ models });
  } catch (err: unknown) {
    const ax = err as { response?: { status?: number; data?: unknown }; message?: string };
    const status = ax.response?.status;
    const msg =
      status === 401 || status === 403
        ? 'Chave OpenAI inválida ou sem permissão para listar modelos.'
        : 'Não foi possível consultar a OpenAI. Tente de novo em instantes.';
    // 400 evita confusão com 401 de sessão do painel
    return res.status(400).json({
      error: msg,
      models: [] as string[],
      details: process.env.NODE_ENV === 'development' ? ax.response?.data : undefined,
    });
  }
});

export default router;
