import React, { useEffect, useState } from 'react';
import {
    ANALYSIS_PROFILE_OPTIONS,
    type AnalysisProfileId,
    type ReportWizardGenerateContext,
} from '../../lib/analysis-profile';

interface ReportWizardProps {
    open: boolean;
    onClose: () => void;
    onGenerate: (context: ReportWizardGenerateContext) => void;
    ads: Array<{ id: string; name: string }>;
    loading: boolean;
}

const OBJECTIVES = [
    { value: 'leads', label: '🎯 Leads / Cadastros' },
    { value: 'purchases', label: '🛒 Compras / Vendas' },
    { value: 'engagement', label: '💬 Engajamento' },
    { value: 'traffic', label: '🔗 Tráfego' },
    { value: 'awareness', label: '📢 Alcance / Reconhecimento' },
    { value: 'custom', label: '⚙️ Evento Customizado' },
];

export const ReportWizard: React.FC<ReportWizardProps> = ({
    open,
    onClose,
    onGenerate,
    ads,
    loading,
}) => {
    const [step, setStep] = useState(1);
    const [objective, setObjective] = useState('');
    const [customObjective, setCustomObjective] = useState('');
    const [lpUrl, setLpUrl] = useState('');
    const [selectedAdIds, setSelectedAdIds] = useState<string[]>(ads.map((a) => a.id));
    const [analysisProfile, setAnalysisProfile] = useState<AnalysisProfileId>('full');

    useEffect(() => {
        if (!open) return;
        setAnalysisProfile('full');
        setSelectedAdIds(ads.map((a) => a.id));
    }, [open, ads]);

    if (!open) return null;

    const finalObjective = objective === 'custom' ? customObjective : objective;
    const canNext1 = !!finalObjective;
    const canNext2 = !!lpUrl && lpUrl.startsWith('http');

    const toggleAd = (adId: string) => {
        setSelectedAdIds((prev) =>
            prev.includes(adId) ? prev.filter((id) => id !== adId) : [...prev, adId]
        );
    };

    const handleGenerate = () => {
        onGenerate({
            objective: finalObjective,
            landing_page_url: lpUrl,
            selected_ad_ids: selectedAdIds.length > 0 ? selectedAdIds : undefined,
            analysisProfile,
        });
    };

    const inputCls =
        'w-full rounded-lg bg-zinc-100 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800 px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-200 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/40 transition-all placeholder:text-zinc-500';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

            {/* Modal */}
            <div className="relative w-full max-w-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="px-6 pt-5 pb-4 border-b border-zinc-200 dark:border-zinc-800">
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                            {step === 1 && '🎯 Objetivo da Campanha'}
                            {step === 2 && '🔗 Página de Destino'}
                            {step === 3 && '🎨 Criativos (Opcional)'}
                        </h2>
                        <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M18 6 6 18" />
                                <path d="m6 6 12 12" />
                            </svg>
                        </button>
                    </div>
                    {/* Progress */}
                    <div className="flex gap-1.5 mt-3">
                        {[1, 2, 3].map((s) => (
                            <div
                                key={s}
                                className={`h-1 flex-1 rounded-full transition-colors ${s <= step ? 'bg-blue-500' : 'bg-zinc-200 dark:bg-zinc-800'}`}
                            />
                        ))}
                    </div>
                </div>

                {/* Body */}
                <div className="px-6 py-5 max-h-[60vh] overflow-y-auto">
                    {/* Step 1: Objective */}
                    {step === 1 && (
                        <div className="space-y-3">
                            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
                                Qual o objetivo principal desta campanha?
                            </p>
                            {OBJECTIVES.map((opt) => (
                                <button
                                    key={opt.value}
                                    onClick={() => setObjective(opt.value)}
                                    className={`w-full text-left px-4 py-3 rounded-xl border transition-all text-sm font-medium ${objective === opt.value
                                        ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                                        : 'border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:border-zinc-400 dark:hover:border-zinc-600'
                                        }`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                            {objective === 'custom' && (
                                <input
                                    type="text"
                                    placeholder="Nome do evento customizado (ex: Cadastro_Grupo)"
                                    value={customObjective}
                                    onChange={(e) => setCustomObjective(e.target.value)}
                                    className={inputCls + ' mt-2'}
                                    autoFocus
                                />
                            )}
                        </div>
                    )}

                    {/* Step 2: Landing Page URL */}
                    {step === 2 && (
                        <div className="space-y-4">
                            <p className="text-sm text-zinc-600 dark:text-zinc-400">
                                Para qual página o anúncio está levando?
                            </p>
                            <input
                                type="url"
                                placeholder="https://seusite.com/oferta"
                                value={lpUrl}
                                onChange={(e) => setLpUrl(e.target.value)}
                                className={inputCls}
                                autoFocus
                            />
                            <p className="text-xs text-zinc-500 dark:text-zinc-600">
                                💡 Cole a URL exata da página de destino do anúncio para uma análise precisa.
                            </p>
                        </div>
                    )}

                    {/* Step 3: Creatives (Optional) */}
                    {step === 3 && (
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <label
                                    htmlFor="report-wizard-analysis-profile"
                                    className="block text-sm font-medium text-zinc-800 dark:text-zinc-200"
                                >
                                    Tipo de relatório
                                </label>
                                <select
                                    id="report-wizard-analysis-profile"
                                    value={analysisProfile}
                                    onChange={(e) => setAnalysisProfile(e.target.value as AnalysisProfileId)}
                                    className={inputCls}
                                >
                                    {ANALYSIS_PROFILE_OPTIONS.map((opt) => (
                                        <option key={opt.value} value={opt.value} title={opt.description}>
                                            {opt.label}
                                        </option>
                                    ))}
                                </select>
                                <p className="text-xs text-zinc-500 dark:text-zinc-600 leading-relaxed">
                                    O mesmo período e dados da campanha são usados; muda o foco do texto gerado pela IA.
                                </p>
                            </div>
                            <p className="text-sm text-zinc-600 dark:text-zinc-400">
                                Selecione quais criativos você deseja que a inteligência artificial analise. O conteúdo real dos anúncios será buscado automaticamente da API do Meta.
                            </p>
                            {ads.length === 0 ? (
                                <p className="text-sm text-zinc-500">Nenhum anúncio encontrado nesta campanha.</p>
                            ) : (
                                <div className="space-y-2 max-h-[30vh] overflow-y-auto pr-2">
                                    {ads.map((ad) => {
                                        const isSelected = selectedAdIds.includes(ad.id);
                                        return (
                                            <label
                                                key={ad.id}
                                                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${isSelected
                                                    ? 'border-blue-500 bg-blue-500/5'
                                                    : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700'
                                                    }`}
                                            >
                                                <input
                                                    type="checkbox"
                                                    className="w-4 h-4 text-blue-600 rounded border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 focus:ring-blue-500"
                                                    checked={isSelected}
                                                    onChange={() => toggleAd(ad.id)}
                                                />
                                                <span className={`text-sm font-medium ${isSelected ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-600 dark:text-zinc-400'}`}>
                                                    {ad.name || `Anúncio ${ad.id}`}
                                                </span>
                                            </label>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                    <div>
                        {step > 1 && (
                            <button
                                onClick={() => setStep(step - 1)}
                                className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
                            >
                                ← Voltar
                            </button>
                        )}
                    </div>

                    <div className="flex gap-2">

                        {step < 3 ? (
                            <button
                                onClick={() => setStep(step + 1)}
                                disabled={step === 1 ? !canNext1 : !canNext2}
                                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                Próximo →
                            </button>
                        ) : (
                            <button
                                onClick={handleGenerate}
                                disabled={loading}
                                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/20 transition-all disabled:opacity-40"
                            >
                                {loading ? (
                                    <>
                                        <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                        </svg>
                                        Gerando...
                                    </>
                                ) : (
                                    <>✨ Gerar Relatório</>
                                )}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ReportWizard;
