export type AnalysisPromptContext = {
  hasMessageMatch: boolean;
  hasTrend: boolean;
  hasLPDeepAudit: boolean;
  hasLPAnyText: boolean;
  hasCreatives: boolean;
  hasTemporalData: boolean;
  temporalHasVolume: boolean;
  hasMetaSpend: boolean;
  hasAdsBreakdown: boolean;
  hasUserStatedObjective: boolean;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function buildAnalysisPromptContext(snapshot?: Record<string, unknown>): AnalysisPromptContext {
  const snap = snapshot || {};
  const meta = asRecord(snap.meta);
  const uc = asRecord(snap.user_context);
  const lp = asRecord(snap.landing_page);
  const mb = asRecord(snap.meta_breakdown);
  const segments = asRecord(snap.segments);
  const creatives = Array.isArray(uc.creatives) ? uc.creatives : [];
  const ads = Array.isArray(mb.ads) ? mb.ads : [];
  const lpContent = typeof lp.content === 'string' ? lp.content : '';
  const lpSource = typeof lp.content_source === 'string' ? lp.content_source : '';

  const hasTemporalData =
    Object.keys(asRecord(segments.hourly)).length > 0 ||
    Object.keys(asRecord(segments.day_of_week)).length > 0;

  const temporalHasVolume =
    Number(meta.purchases || 0) >= 10 ||
    Number(meta.results || 0) >= 10 ||
    Number(meta.unique_link_clicks || 0) >= 250;

  return {
    hasMessageMatch: !!snap.message_match,
    hasTrend: !!snap.trend,
    hasLPDeepAudit: lpSource === 'http_html_text' && lpContent.length >= 1200,
    hasLPAnyText: lpContent.length > 0,
    hasCreatives: creatives.length > 0,
    hasTemporalData,
    temporalHasVolume,
    hasMetaSpend: Number(meta.spend || 0) > 0,
    hasAdsBreakdown: ads.length > 0,
    hasUserStatedObjective: typeof uc.stated_objective === 'string' && uc.stated_objective.trim().length > 0,
  };
}
