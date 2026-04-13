import { z } from 'zod';
import { analysisProfileSchema } from './prompts/analysis-profiles';

const trimmedString = z.string().trim().min(1);

const optionalTrimmedString = z
  .string()
  .trim()
  .transform((value) => (value.length ? value : undefined))
  .optional();

const optionalUrlString = z
  .string()
  .trim()
  .url()
  .transform((value) => (value.length ? value : undefined))
  .optional();

const selectedAdIdsSchema = z
  .array(z.string().trim().min(1))
  .transform((items) => Array.from(new Set(items)))
  .optional();

export const recommendationUserContextSchema = z
  .object({
    stated_objective: optionalTrimmedString,
    landing_page_url: optionalUrlString,
    selected_ad_ids: selectedAdIdsSchema,
  })
  .transform((value) => {
    const clean = Object.fromEntries(
      Object.entries(value).filter(([, current]) => {
        if (current === undefined) return false;
        if (Array.isArray(current)) return current.length > 0;
        return current !== '';
      })
    );
    return Object.keys(clean).length ? clean : undefined;
  });

export const recommendationGenerateInputSchema = z.object({
  siteKey: trimmedString,
  campaignId: trimmedString,
  days: z.number().int().min(1).max(90).default(7),
  datePreset: optionalTrimmedString,
  since: optionalTrimmedString,
  until: optionalTrimmedString,
  force: z.boolean().default(false),
  utmFilters: z
    .object({
      utm_source: optionalTrimmedString,
      utm_medium: optionalTrimmedString,
      utm_campaign: optionalTrimmedString,
      utm_content: optionalTrimmedString,
      utm_term: optionalTrimmedString,
      click_id: optionalTrimmedString,
    })
    .transform((value) => {
      const clean = Object.fromEntries(Object.entries(value).filter(([, current]) => current !== undefined));
      return Object.keys(clean).length ? clean : undefined;
    })
    .optional(),
  userContext: recommendationUserContextSchema.optional(),
  analysisProfile: analysisProfileSchema.optional(),
});

export const recommendationChatInputSchema = z.object({
  siteKey: optionalTrimmedString,
  siteId: z.number().int().positive().optional(),
  campaignId: trimmedString,
  datePreset: optionalTrimmedString,
  since: optionalTrimmedString,
  until: optionalTrimmedString,
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1),
      })
    )
    .max(30)
    .default([]),
}).refine((value) => value.siteKey || value.siteId, {
  message: 'siteKey ou siteId e obrigatorio',
  path: ['siteKey'],
});

export const mentorCoachInputSchema = z.object({
  siteKey: trimmedString,
  focusPhaseId: optionalTrimmedString,
  completedItemIds: z.array(z.string().trim().min(1)).default([]).transform((items) => Array.from(new Set(items))),
  campaignId: optionalTrimmedString,
});

export type RecommendationGenerateInput = z.infer<typeof recommendationGenerateInputSchema>;
export type RecommendationChatInput = z.infer<typeof recommendationChatInputSchema>;
export type MentorCoachInput = z.infer<typeof mentorCoachInputSchema>;

type AgentCapabilityDefinition = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  inputSchema: z.ZodTypeAny;
};

export const agentCapabilities: AgentCapabilityDefinition[] = [
  {
    id: 'site-analysis',
    name: 'Site Analysis',
    description:
      'Gera diagnostico de campanha/site (Meta, CAPI, landing, vendas). Campo opcional analysisProfile: full | landing-page | funnel | creative.',
    tags: ['analysis', 'site', 'campaign', 'future-skill'],
    inputSchema: recommendationGenerateInputSchema,
  },
  {
    id: 'metrics-analysis',
    name: 'Metrics Analysis Chat',
    description: 'Responde perguntas curtas sobre gargalos de funil e metricas de campanha.',
    tags: ['analysis', 'metrics', 'chat', 'future-skill'],
    inputSchema: recommendationChatInputSchema,
  },
  {
    id: 'landing-page-analysis',
    name: 'Landing Page Analysis',
    description: 'Especialista em landing page, comportamento e message match para diagnosticos de CRO.',
    tags: ['analysis', 'landing-page', 'cro', 'future-skill'],
    inputSchema: recommendationGenerateInputSchema,
  },
  {
    id: 'funnel-diagnosis',
    name: 'Funnel Diagnosis',
    description: 'Especialista em gargalos de funil, metricas de campanha e priorizacao de proximos testes.',
    tags: ['analysis', 'funnel', 'metrics', 'future-skill'],
    inputSchema: recommendationGenerateInputSchema,
  },
  {
    id: 'creative-analysis',
    name: 'Creative Analysis',
    description: 'Especialista em leitura de criativos, hooks, copy e decisao de otimizacao por anuncio.',
    tags: ['analysis', 'creatives', 'copy', 'future-skill'],
    inputSchema: recommendationGenerateInputSchema,
  },
  {
    id: 'mentor-guidance',
    name: 'Mentor Guidance',
    description: 'Gera orientacao priorizada da trilha Meta Ads com base no checklist e sinais do site.',
    tags: ['mentor', 'checklist', 'future-skill'],
    inputSchema: mentorCoachInputSchema,
  },
];
