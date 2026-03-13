import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Layout } from '../components/Layout';

type GlobalNotification = {
  id: number;
  title: string;
  message: string;
  image_url: string | null;
  image_link: string | null;
  action_text: string | null;
  action_url: string | null;
  is_active: boolean;
  expires_at: string | null;
  created_at: string;
  read_count: number;
};

export const NotificationsPage = () => {
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [imageLink, setImageLink] = useState('');
  const [actionText, setActionText] = useState('');
  const [actionUrl, setActionUrl] = useState('');
  const [loading, setLoading] = useState(false);

  const [history, setHistory] = useState<GlobalNotification[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const loadHistory = async () => {
    try {
      const res = await api.get('/admin/notifications');
      setHistory(res.data);
    } catch { /* silent */ }
    finally { setHistoryLoading(false); }
  };

  useEffect(() => { loadHistory(); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      await api.post('/admin/notifications', {
        title, message,
        image_url: imageUrl || null,
        image_link: imageLink || null,
        action_text: actionText || null,
        action_url: actionUrl || null,
        expires_at,
      });
      setTitle(''); setMessage(''); setImageUrl(''); setImageLink(''); setActionText(''); setActionUrl('');
      await loadHistory();
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Erro ao enviar');
    } finally {
      setLoading(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await api.post('/upload/image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setImageUrl(res.data.url);
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Erro ao enviar imagem');
    } finally {
      setLoading(false);
      e.target.value = '';
    }
  };

  const isExpired = (n: GlobalNotification) => {
    if (!n.expires_at) return false;
    return new Date(n.expires_at).getTime() < Date.now();
  };

  return (
    <Layout title="Avisos Globais (Broadcast)">
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* Form */}
        <div className="lg:col-span-2">
          <div className="bg-white dark:bg-zinc-900/50 rounded-2xl border border-zinc-200 dark:border-white/10 p-6 shadow-sm sticky top-24">
            <h2 className="text-lg font-bold mb-1">Disparar Notificação</h2>
            <p className="text-sm text-zinc-500 mb-5">Aparece no sino de todos os clientes Trajettu.</p>

            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Título</label>
                <input
                  required value={title} onChange={e => setTitle(e.target.value)}
                  className="w-full rounded-xl bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 px-4 py-2.5 text-sm outline-none focus:border-indigo-500 transition-colors"
                  placeholder="Ex: Nova atualização disponível!"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Mensagem</label>
                <textarea
                  required value={message} onChange={e => setMessage(e.target.value)} rows={3}
                  className="w-full rounded-xl bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 px-4 py-2.5 text-sm outline-none focus:border-indigo-500 transition-colors"
                  placeholder="Detalhes sobre a novidade..."
                />
              </div>
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Imagem (Opcional)</label>
                  <div className="flex gap-2">
                    <input
                      value={imageUrl} onChange={e => setImageUrl(e.target.value)}
                      className="flex-1 min-w-0 rounded-xl bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 px-3 py-2.5 text-sm outline-none focus:border-indigo-500 transition-colors"
                      placeholder="URL da imagem"
                    />
                    <label className="flex items-center justify-center px-3 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-white/5 dark:hover:bg-white/10 border border-zinc-200 dark:border-white/10 rounded-xl cursor-pointer transition-colors shrink-0">
                      <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Upload</span>
                      <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                    </label>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Link da Imagem (Opcional)</label>
                  <input
                    value={imageLink} onChange={e => setImageLink(e.target.value)}
                    className="w-full rounded-xl bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 px-3 py-2.5 text-sm outline-none focus:border-indigo-500 transition-colors"
                    placeholder="Ao clicar na imagem..."
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Texto do Botão</label>
                  <input
                    value={actionText} onChange={e => setActionText(e.target.value)}
                    className="w-full rounded-xl bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 px-3 py-2.5 text-sm outline-none focus:border-indigo-500 transition-colors"
                    placeholder="Ex: Ver agora"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">URL do Botão</label>
                  <input
                    value={actionUrl} onChange={e => setActionUrl(e.target.value)}
                    className="w-full rounded-xl bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 px-3 py-2.5 text-sm outline-none focus:border-indigo-500 transition-colors"
                    placeholder="https://..."
                  />
                </div>
              </div>
              <button disabled={loading} className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold text-sm py-3 rounded-xl shadow-[0_8px_25px_rgba(79,70,229,0.25)] transition-all disabled:opacity-50">
                {loading ? 'Enviando...' : 'Publicar Aviso'}
              </button>
            </form>
          </div>
        </div>

        {/* History */}
        <div className="lg:col-span-3">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-zinc-600 dark:text-zinc-300 uppercase tracking-wider">Histórico de Avisos</h2>
            <span className="text-xs text-zinc-400">{history.length} enviados</span>
          </div>

          {historyLoading && <div className="text-sm text-zinc-500 py-8 text-center">Carregando...</div>}

          {!historyLoading && history.length === 0 && (
            <div className="text-sm text-zinc-500 py-8 text-center bg-white dark:bg-zinc-900/50 rounded-2xl border border-zinc-200 dark:border-white/10">
              Nenhuma notificação enviada ainda.
            </div>
          )}

          <div className="space-y-3">
            {history.map(n => {
              const expired = isExpired(n);
              return (
                <div
                  key={n.id}
                  className={`bg-white dark:bg-zinc-900/50 rounded-2xl border border-zinc-200 dark:border-white/10 p-4 shadow-sm transition-opacity ${expired ? 'opacity-50' : ''}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-sm text-zinc-900 dark:text-white truncate">{n.title}</h3>
                        {expired && (
                          <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500 dark:bg-white/5 dark:text-zinc-500 shrink-0">
                            Expirado
                          </span>
                        )}
                        {!expired && n.is_active && (
                          <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400 shrink-0">
                            Ativo
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2">{n.message}</p>

                      {(n.image_url || n.action_text) && (
                        <div className="flex items-center gap-3 mt-2">
                          {n.image_url && (
                            <span className="text-[10px] text-zinc-400 flex items-center gap-1">
                              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></svg>
                              Imagem
                            </span>
                          )}
                          {n.action_text && (
                            <span className="text-[10px] text-zinc-400 flex items-center gap-1">
                              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-4.5-4.5 4.5 4.5m0-4.5H14m4 0V10" /></svg>
                              {n.action_text}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[10px] text-zinc-400">{new Date(n.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
                      <div className="text-[10px] text-zinc-400 mt-0.5">{new Date(n.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
                      <div className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-medium text-indigo-500 dark:text-indigo-400">
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" /><path strokeLinecap="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>
                        {Number(n.read_count)} lidos
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Layout>
  );
};
