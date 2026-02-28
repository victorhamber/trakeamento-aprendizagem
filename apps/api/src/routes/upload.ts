import { Router } from 'express';
import multer from 'multer';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import os from 'os';
import FormData from 'form-data';
import { requireAuth } from '../middleware/auth';
import { pool } from '../db/pool';
import { decryptString } from '../lib/crypto';

const router = Router();

// Multer config: 50MB limit, cross-platform temp storage
const uploadDir = path.join(os.tmpdir(), 'ta-uploads');
try { fs.mkdirSync(uploadDir, { recursive: true }); } catch { /* ignore */ }

const upload = multer({
    dest: uploadDir,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB for videos
    fileFilter: (_req, file, cb) => {
        const allowed = [
            'image/jpeg', 'image/png', 'image/webp', 'image/gif',
            'video/mp4', 'video/quicktime', 'video/webm', 'video/avi',
            'video/x-msvideo', 'video/x-matroska',
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
 * - Videos/Audio: transcribed with Whisper
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
                    timeout: 60000,
                }
            );

            mediaDescription = response.data?.choices?.[0]?.message?.content || 'Não foi possível descrever a imagem.';
        } else if (isVideo || isAudio) {
            // Whisper API supports: mp3, mp4, mpeg, mpga, m4a, wav, webm
            // Rename temp file with proper extension so Whisper recognizes it
            const extMap: Record<string, string> = {
                'video/mp4': '.mp4',
                'video/quicktime': '.mp4',
                'video/webm': '.webm',
                'video/avi': '.mp4',
                'video/x-msvideo': '.mp4',
                'video/x-matroska': '.mp4',
                'audio/mpeg': '.mp3',
                'audio/mp4': '.m4a',
                'audio/wav': '.wav',
                'audio/webm': '.webm',
            };
            const ext = extMap[file.mimetype] || '.mp4';
            const renamedPath = file.path + ext;
            fs.renameSync(file.path, renamedPath);
            file.path = renamedPath;

            const form = new FormData();
            form.append('file', fs.createReadStream(renamedPath), {
                filename: (file.originalname || `creative${ext}`),
                contentType: file.mimetype,
            });
            form.append('model', 'whisper-1');
            form.append('language', 'pt');
            form.append('response_format', 'text');

            console.log(`[Upload] Sending ${isVideo ? 'video' : 'audio'} to Whisper API: ${file.originalname} (${(file.size / 1024 / 1024).toFixed(1)}MB)`);

            const whisperRes = await axios.post(
                'https://api.openai.com/v1/audio/transcriptions',
                form,
                {
                    headers: {
                        Authorization: `Bearer ${apiKey}`,
                        ...form.getHeaders(),
                    },
                    timeout: 180000, // 3 min for long videos
                    maxContentLength: 60 * 1024 * 1024,
                    maxBodyLength: 60 * 1024 * 1024,
                }
            );

            const transcript = typeof whisperRes.data === 'string'
                ? whisperRes.data.trim()
                : whisperRes.data?.text?.trim() || '';

            console.log(`[Upload] Whisper transcription result: ${transcript.length} chars`);

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
        const axiosErr = err as { response?: { data?: unknown; status?: number } };
        const message = axiosErr?.response?.data
            ? `Erro da API: ${JSON.stringify(axiosErr.response.data).slice(0, 200)}`
            : err instanceof Error ? err.message : 'Erro ao processar criativo.';
        res.status(500).json({ error: message });
    } finally {
        // Cleanup temp file
        if (file?.path) {
            try { fs.unlinkSync(file.path); } catch { /* ignore */ }
        }
    }
});

export default router;
