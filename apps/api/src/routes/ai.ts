import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { encryptString } from '../lib/crypto';
import { agentCapabilities } from '../services/agent-tools';
import { ANALYSIS_PROFILE_DEFAULT, ANALYSIS_PROFILES } from '../services/prompts/analysis-profiles';
import { analysisPromptModuleCatalog } from '../services/prompts/analysis-system-prompt';
import { OPENAI_CHAT_MODEL } from '../constants/openai-chat-model';

const router = Router();

router.get('/capabilities', requireAuth, (_req, res) => {
  return res.json({
    capabilities: agentCapabilities.map((capability) => ({
      id: capability.id,
      name: capability.name,
      description: capability.description,
      tags: capability.tags,
    })),
    analysis_modules: analysisPromptModuleCatalog,
    analysis_profiles: [...ANALYSIS_PROFILES],
    analysis_profile_default: ANALYSIS_PROFILE_DEFAULT,
  });
});

router.get('/settings', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const result = await pool.query(
    `SELECT (openai_api_key_enc IS NOT NULL) as has_key
     FROM account_settings WHERE account_id = $1`,
    [auth.accountId]
  );
  const row = result.rows[0];
  const hasEnvKey = !!process.env.OPENAI_API_KEY;
  return res.json({
    has_openai_key: (row?.has_key || hasEnvKey),
    openai_model: OPENAI_CHAT_MODEL,
    using_env_key: hasEnvKey && !row?.has_key
  });
});

router.put('/settings', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const { openai_api_key } = req.body || {};

  const keyEnc =
    typeof openai_api_key === 'string' && openai_api_key.trim() ? encryptString(openai_api_key.trim()) : null;

  await pool.query(
    `INSERT INTO account_settings (account_id, openai_api_key_enc, openai_model)
     VALUES ($1, $2, $3)
     ON CONFLICT (account_id) DO UPDATE SET
       openai_api_key_enc = CASE WHEN EXCLUDED.openai_api_key_enc IS NULL THEN account_settings.openai_api_key_enc ELSE EXCLUDED.openai_api_key_enc END,
       openai_model = EXCLUDED.openai_model,
       updated_at = NOW()`,
    [auth.accountId, keyEnc, OPENAI_CHAT_MODEL]
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

export default router;
