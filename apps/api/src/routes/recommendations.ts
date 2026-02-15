import { Router } from 'express';
import { diagnosisService } from '../services/diagnosis';

const router = Router();

router.post('/generate', async (req, res) => {
  const siteKey = req.query.key || req.headers['x-site-key'];
  if (!siteKey) return res.status(400).json({ error: 'Missing site key' });

  try {
    if (!process.env.OPENAI_API_KEY) {
       console.warn('OPENAI_API_KEY is missing. Skipping AI diagnosis.');
       return res.json({ 
          status: 'skipped', 
          message: 'IA não configurada no servidor. Adicione a variável OPENAI_API_KEY.',
          recommendations: [] 
       });
    }
    const report = await diagnosisService.generateReport(siteKey as string);
    res.json(report);
  } catch (err: any) {
    console.error('Diagnosis error:', err);
    res.status(500).json({ error: 'Erro ao gerar diagnóstico: ' + (err.message || 'Erro desconhecido') });
  }
});

export default router;
