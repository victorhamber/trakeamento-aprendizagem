import { Router } from 'express';
import multer from 'multer';
import axios from 'axios';
import fs from 'fs';
import FormData from 'form-data';
import { requireAuth } from '../middleware/auth';
import { pool } from '../db/pool';
import { decryptString } from '../lib/crypto';

const router = Router();

// Multer config: 25MB limit, temp storage
const upload = multer({
    dest: '/tmp/uploads/',
    limits: { fileSize: 25 * 1024 * 1024 }, // 25MB (Whisper API limit)
    fileFilter: (_req, file, cb) => {
        const allowed = [
            'image/jpeg', 'image/png', 'image/webp', 'image/gif',
            'video/mp4', 'video/quicktime', 'video/webm', 'video/avi',
            'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/webm',
        ];
        if (allowed.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(`Tipo de arquivo não suportado: ${file.mimetype}`));
        }
    },
});

async function getOpenAIKey(siteKey: string): Promise<string> {
    // Try site-specific key first
    const siteRes = await pool.query(
        `SELECT a.openai_api_key_enc FROM account_settings a
     JOIN sites s ON s.account_id = a.account_id
     WHERE s.site_key = $1`,
        [siteKey]
    );
    if (siteRes.rows[0]?.openai_api_key_enc) {
        return decryptString(siteRes.rows[0].openai_api_key_enc);
    }
    return process.env.OPENAI_API_KEY || '';
}

/**
 * POST /upload/creative
 * Uploads a creative file (image or video) and returns a text description.
 * - Images: analyzed with GPT-4o Vision
 * - Videos: transcribed with Whisper, then described with GPT-4o
 */
router.post('/creative', requireAuth, upload.single('file'), async (req, res) => {
    const file = req.file;
    const siteKey = req.query.key || req.headers['x-site-key'];
    const adName = typeof req.body?.ad_name === 'string' ? req.body.ad_name : 'Anúncio';

    if (!file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    if (!siteKey) return res.status(400).json({ error: 'Missing site key.' });

    try {
        const apiKey = await getOpenAIKey(siteKey as string);
        if (!apiKey) {
            return res.status(400).json({ error: 'OpenAI API key não configurada.' });
        }

        const isVideo = file.mimetype.startsWith('video/');
        const isAudio = file.mimetype.startsWith('audio/');
        const isImage = file.mimetype.startsWith('image/');

        let mediaDescription = '';

        if (isImage) {
            // GPT-4o Vision: describe the image
            const base64 = fs.readFileSync(file.path).toString('base64');
            const dataUri = `data:${file.mimetype};base64,${base64}`;

            const response = await axios.post(
                'https://api.openai.com/v1/chat/completions',
                {
                    model: 'gpt-4o',
                    max_tokens: 500,
                    messages: [
                        {
                            role: 'system',
                            content: 'Voce e um analista de criativos de anuncios. Descreva a imagem em detalhe: elementos visuais, texto overlay, cores, call-to-action, emocao transmitida. Seja objetivo e tecnico. Responda em portugues.',
                        },
                        {
                            role: 'user',
                            content: [
                                { type: 'text', text: `Descreva este criativo do anuncio "${adName}":` },
                                { type: 'image_url', image_url: { url: dataUri, detail: 'low' } },
                            ],
                        },
                    ],
                },
                {
                    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                    timeout: 30000,
                }
            );

            mediaDescription = response.data?.choices?.[0]?.message?.content || 'Não foi possível descrever a imagem.';
        } else if (isVideo || isAudio) {
            // Whisper: transcribe audio/video
            const form = new FormData();
            form.append('file', fs.createReadStream(file.path), {
                filename: file.originalname,
                contentType: file.mimetype,
            });
            form.append('model', 'whisper-1');
            form.append('language', 'pt');
            form.append('response_format', 'text');

            const whisperRes = await axios.post(
                'https://api.openai.com/v1/audio/transcriptions',
                form,
                {
                    headers: {
                        Authorization: `Bearer ${apiKey}`,
                        ...form.getHeaders(),
                    },
                    timeout: 120000, // 2 min for long videos
                    maxContentLength: 30 * 1024 * 1024,
                    maxBodyLength: 30 * 1024 * 1024,
                }
            );

            const transcript = typeof whisperRes.data === 'string'
                ? whisperRes.data.trim()
                : whisperRes.data?.text?.trim() || '';

            if (transcript) {
                mediaDescription = `[TRANSCRICAO DO VIDEO]\n${transcript}`;
            } else {
                mediaDescription = 'Video sem fala/audio detectavel.';
            }
        }

        res.json({
            media_description: mediaDescription,
            media_type: isImage ? 'image' : isVideo ? 'video' : 'audio',
            file_name: file.originalname,
        });
    } catch (err: unknown) {
        console.error('[Upload] Error processing creative:', err);
        const message = err instanceof Error ? err.message : 'Erro ao processar criativo.';
        res.status(500).json({ error: message });
    } finally {
        // Cleanup temp file
        if (file?.path) {
            try { fs.unlinkSync(file.path); } catch { /* ignore */ }
        }
    }
});

export default router;
