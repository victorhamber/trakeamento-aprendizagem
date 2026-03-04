import React, { useState } from 'react';
import { api } from '../lib/api';
import { Layout } from '../components/Layout';

export const NotificationsPage = () => {
    const [title, setTitle] = useState('');
    const [message, setMessage] = useState('');
    const [type, setType] = useState('info');
    const [loading, setLoading] = useState(false);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            // 7 days expiration by default
            const expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
            await api.post('/admin/notifications', { title, message, type, expires_at });
            alert('Notificação enviada para todos os clientes!');
            setTitle('');
            setMessage('');
        } catch (err: any) {
            alert(err?.response?.data?.error || 'Erro ao enviar');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Layout title="Avisos Globais (Broadcast)">
            <div className="max-w-xl mx-auto bg-white dark:bg-zinc-900/50 rounded-2xl border border-zinc-200 dark:border-white/10 p-6 shadow-sm mt-8">
                <h2 className="text-lg font-bold mb-1">Disparar Notificação</h2>
                <p className="text-sm text-zinc-500 mb-6">Esta mensagem aparecerá no sino de notificações de todos os clientes Trajettu.</p>

                <form onSubmit={submit} className="space-y-4">
                    <div>
                        <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Título da mensagem</label>
                        <input
                            required value={title} onChange={e => setTitle(e.target.value)}
                            className="w-full rounded-xl bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 px-4 py-3 text-sm outline-none focus:border-indigo-500 transition-colors"
                            placeholder="Ex: Nova atualização disponível!"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Conteúdo texto</label>
                        <textarea
                            required value={message} onChange={e => setMessage(e.target.value)} rows={4}
                            className="w-full rounded-xl bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 px-4 py-3 text-sm outline-none focus:border-indigo-500 transition-colors"
                            placeholder="Detalhes sobre a novidade ou manutenção..."
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Tipo / Cor</label>
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                            {['info', 'success', 'warning', 'error'].map(t => (
                                <label key={t} className={`flex items-center justify-center p-3 rounded-xl border cursor-pointer transition-colors ${type === t ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-400' : 'border-zinc-200 dark:border-white/10 text-zinc-500'}`}>
                                    <input type="radio" value={t} checked={type === t} onChange={() => setType(t)} className="hidden" />
                                    <span className="text-xs uppercase font-bold">{t}</span>
                                </label>
                            ))}
                        </div>
                    </div>
                    <button disabled={loading} className="w-full mt-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold text-sm py-3.5 rounded-xl shadow-[0_8px_25px_rgba(79,70,229,0.25)] transition-all">
                        {loading ? 'Enviando...' : 'Publicar Aviso para Todos'}
                    </button>
                </form>
            </div>
        </Layout>
    );
};
