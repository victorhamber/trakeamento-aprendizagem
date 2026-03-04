import { useState } from 'react';
import { api } from '../lib/api';
import { Layout } from '../components/Layout';

export const NotificationsPage = () => {
    const [title, setTitle] = useState('');
    const [message, setMessage] = useState('');
    const [imageUrl, setImageUrl] = useState('');
    const [imageLink, setImageLink] = useState('');
    const [actionText, setActionText] = useState('');
    const [actionUrl, setActionUrl] = useState('');
    const [loading, setLoading] = useState(false);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            // 7 days expiration by default
            const expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
            await api.post('/admin/notifications', {
                title,
                message,
                image_url: imageUrl,
                image_link: imageLink,
                action_text: actionText,
                action_url: actionUrl,
                expires_at
            });
            alert('Notificação enviada para todos os clientes!');
            setTitle('');
            setMessage('');
            setImageUrl('');
            setImageLink('');
            setActionText('');
            setActionUrl('');
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
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">URL da Imagem (Opcional)</label>
                            <input
                                value={imageUrl} onChange={e => setImageUrl(e.target.value)}
                                className="w-full rounded-xl bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 px-4 py-3 text-sm outline-none focus:border-indigo-500 transition-colors"
                                placeholder="http://.../banner.png"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Link ao clicar na Imagem (Opcional)</label>
                            <input
                                value={imageLink} onChange={e => setImageLink(e.target.value)}
                                className="w-full rounded-xl bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 px-4 py-3 text-sm outline-none focus:border-indigo-500 transition-colors"
                                placeholder="http://... (Ao clicar no banner)"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Texto do Botão (Opcional)</label>
                            <input
                                value={actionText} onChange={e => setActionText(e.target.value)}
                                className="w-full rounded-xl bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 px-4 py-3 text-sm outline-none focus:border-indigo-500 transition-colors"
                                placeholder="Ex: Assistir Aula"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">URL do Botão (Opcional)</label>
                            <input
                                value={actionUrl} onChange={e => setActionUrl(e.target.value)}
                                className="w-full rounded-xl bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 px-4 py-3 text-sm outline-none focus:border-indigo-500 transition-colors"
                                placeholder="http://..."
                            />
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
