import React, { useState, useRef } from 'react';
import { api } from '../../lib/api';

interface Creative {
    ad_id: string;
    ad_name: string;
    copy: string;
    media_description: string;
    uploading: boolean;
    uploaded: boolean;
    error: string;
}

interface ReportWizardProps {
    open: boolean;
    onClose: () => void;
    onGenerate: (context: {
        objective: string;
        landing_page_url: string;
        creatives?: Creative[];
    }) => void;
    siteKey: string;
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
    siteKey,
    ads,
    loading,
}) => {
    const [step, setStep] = useState(1);
    const [objective, setObjective] = useState('');
    const [customObjective, setCustomObjective] = useState('');
    const [lpUrl, setLpUrl] = useState('');
    const [creatives, setCreatives] = useState<Creative[]>(
        ads.map((ad) => ({
            ad_id: ad.id,
            ad_name: ad.name,
            copy: '',
            media_description: '',
            uploading: false,
            uploaded: false,
            error: '',
        }))
    );
    const [currentAdIndex, setCurrentAdIndex] = useState(0);
    const fileRef = useRef<HTMLInputElement>(null);

    if (!open) return null;

    const finalObjective = objective === 'custom' ? customObjective : objective;
    const canNext1 = !!finalObjective;
    const canNext2 = !!lpUrl && lpUrl.startsWith('http');

    const handleUploadFile = async (file: File) => {
        const updated = [...creatives];
        updated[currentAdIndex] = { ...updated[currentAdIndex], uploading: true };
        setCreatives(updated);

        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('ad_name', creatives[currentAdIndex].ad_name);

            const res = await api.post('/upload/creative', formData, {
                headers: {
                    'x-site-key': siteKey,
                    'Content-Type': 'multipart/form-data',
                },
                timeout: 120000,
            });

            const final = [...creatives];
            final[currentAdIndex] = {
                ...final[currentAdIndex],
                media_description: res.data.media_description || '',
                uploading: false,
                uploaded: true,
            };
            setCreatives(final);
        } catch (err: any) {
            console.error('Upload failed:', err);
            const errMsg = err?.response?.data?.error || err?.message || 'Erro ao processar criativo.';
            const final = [...creatives];
            final[currentAdIndex] = { ...final[currentAdIndex], uploading: false, error: errMsg };
            setCreatives(final);
        }
    };

    const handleCopyChange = (value: string) => {
        const updated = [...creatives];
        updated[currentAdIndex] = { ...updated[currentAdIndex], copy: value };
        setCreatives(updated);
    };

    const handleNextAd = () => {
        if (currentAdIndex < creatives.length - 1) {
            setCurrentAdIndex(currentAdIndex + 1);
        }
    };

    const handleGenerate = () => {
        const filledCreatives = creatives.filter((c) => c.copy || c.media_description);
        onGenerate({
            objective: finalObjective,
            landing_page_url: lpUrl,
            creatives: filledCreatives.length > 0 ? filledCreatives : undefined,
        });
    };

    const currentAd = creatives[currentAdIndex];
    const isLastAd = currentAdIndex >= creatives.length - 1;

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
                            {creatives.length === 0 ? (
                                <p className="text-sm text-zinc-500">Nenhum anúncio encontrado na campanha.</p>
                            ) : (
                                <>
                                    <div className="flex items-center justify-between">
                                        <p className="text-sm text-zinc-600 dark:text-zinc-400">
                                            Anúncio {currentAdIndex + 1} de {creatives.length}
                                        </p>
                                        <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
                                            Opcional
                                        </span>
                                    </div>

                                    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-3">
                                        <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                                            {currentAd?.ad_name || `Anúncio ${currentAdIndex + 1}`}
                                        </h4>

                                        {/* Copy */}
                                        <div>
                                            <label className="block text-xs text-zinc-500 dark:text-zinc-500 mb-1.5">
                                                Copy do anúncio
                                            </label>
                                            <textarea
                                                rows={3}
                                                placeholder="Cole o texto/copy usado neste anúncio..."
                                                value={currentAd?.copy || ''}
                                                onChange={(e) => handleCopyChange(e.target.value)}
                                                className={inputCls + ' resize-none'}
                                            />
                                        </div>

                                        {/* File Upload */}
                                        <div>
                                            <label className="block text-xs text-zinc-500 dark:text-zinc-500 mb-1.5">
                                                Criativo (imagem ou vídeo)
                                            </label>
                                            <input
                                                ref={fileRef}
                                                type="file"
                                                accept="image/*,video/*"
                                                className="hidden"
                                                onChange={(e) => {
                                                    const file = e.target.files?.[0];
                                                    if (file) handleUploadFile(file);
                                                }}
                                            />
                                            {currentAd?.uploading ? (
                                                <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-blue-500/30 bg-blue-500/5 text-sm text-blue-400">
                                                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                                    </svg>
                                                    Processando criativo...
                                                </div>
                                            ) : currentAd?.uploaded ? (
                                                <div className="px-4 py-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 text-sm text-emerald-400">
                                                    ✅ Criativo analisado com sucesso
                                                </div>
                                            ) : (
                                                <button
                                                    onClick={() => fileRef.current?.click()}
                                                    className="w-full px-4 py-3 rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 text-sm text-zinc-500 dark:text-zinc-400 hover:border-blue-500 hover:text-blue-500 transition-all"
                                                >
                                                    📎 Clique para carregar imagem ou vídeo
                                                </button>
                                            )}
                                            {currentAd?.error && (
                                                <div className="px-4 py-3 rounded-xl border border-red-500/30 bg-red-500/5 text-sm text-red-400">
                                                    ❌ {currentAd.error}
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Navigation between ads */}
                                    {!isLastAd && (
                                        <button
                                            onClick={handleNextAd}
                                            className="w-full px-4 py-2.5 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                                        >
                                            Próximo anúncio →
                                        </button>
                                    )}
                                </>
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
                        {step === 3 && (
                            <button
                                onClick={handleGenerate}
                                disabled={loading}
                                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors disabled:opacity-40"
                            >
                                Pular e gerar
                            </button>
                        )}

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
