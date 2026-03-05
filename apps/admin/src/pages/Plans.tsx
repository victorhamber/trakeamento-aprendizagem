import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Layout } from '../components/Layout';

type Plan = {
    id: number;
    name: string;
    type: string;
    price: string;
    billing_cycle: string;
    max_sites: number;
    max_events: number;
};

export const PlansPage = () => {
    const [plans, setPlans] = useState<Plan[]>([]);
    const [loading, setLoading] = useState(true);

    // Form
    const [editingId, setEditingId] = useState<number | null>(null);
    const [name, setName] = useState('');
    const [price, setPrice] = useState('');
    const [type, setType] = useState('SUBSCRIPTION');
    const [cycle, setCycle] = useState('MONTHLY');
    const [sites, setSites] = useState('1');

    const load = async () => {
        try {
            const res = await api.get('/admin/plans');
            setPlans(res.data);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const payload = {
                name,
                type,
                price,
                billing_cycle: cycle,
                max_sites: parseInt(sites, 10),
                max_events: 10000 // default for now
            };

            if (editingId) {
                await api.put(`/admin/plans/${editingId}`, payload);
            } else {
                await api.post('/admin/plans', payload);
            }

            setEditingId(null);
            setName('');
            setPrice('');
            setSites('1');
            setType('SUBSCRIPTION');
            setCycle('MONTHLY');
            await load();
        } catch (e: any) {
            alert(e?.response?.data?.error || 'Erro ao salvar plano');
        }
    };

    const handleEdit = (p: Plan) => {
        setEditingId(p.id);
        setName(p.name);
        setPrice(p.price);
        setType(p.type);
        setCycle(p.billing_cycle);
        setSites(p.max_sites.toString());
        // Scroll to top
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleDelete = async (id: number) => {
        if (!confirm('Tem certeza que deseja excluir este plano? Contas atreladas a ele perderão a referência do plano.')) return;
        try {
            await api.delete(`/admin/plans/${id}`);
            await load();
        } catch (e: any) {
            alert(e?.response?.data?.error || 'Erro ao excluir plano');
        }
    };

    const cancelEdit = () => {
        setEditingId(null);
        setName('');
        setPrice('');
        setSites('1');
        setType('SUBSCRIPTION');
        setCycle('MONTHLY');
    };

    return (
        <Layout title="Planos de Assinatura">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Create form */}
                <div className="lg:col-span-1">
                    <div className="bg-white dark:bg-zinc-900/50 rounded-2xl border border-zinc-200 dark:border-white/10 p-5 shadow-sm">
                        <h2 className="text-sm font-semibold mb-4">{editingId ? 'Editar Plano' : 'Criar Novo Plano'}</h2>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div>
                                <label className="block text-xs text-zinc-500 mb-1">Nome (ex: Pro Mensal)</label>
                                <input required value={name} onChange={e => setName(e.target.value)} className="w-full rounded-xl bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs text-zinc-500 mb-1">Preço (R$)</label>
                                    <input required value={price} onChange={e => setPrice(e.target.value)} type="number" step="0.01" className="w-full rounded-xl bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
                                </div>
                                <div>
                                    <label className="block text-xs text-zinc-500 mb-1">Limite Sites</label>
                                    <input required value={sites} onChange={e => setSites(e.target.value)} type="number" className="w-full rounded-xl bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs text-zinc-500 mb-1">Tipo</label>
                                    <select value={type} onChange={e => setType(e.target.value)} className="w-full rounded-xl bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 px-3 py-2 text-sm outline-none focus:border-indigo-500">
                                        <option value="SUBSCRIPTION">Assinatura Base</option>
                                        <option value="ADDON">Add-on (Extra Site)</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs text-zinc-500 mb-1">Ciclo</label>
                                    <select value={cycle} onChange={e => setCycle(e.target.value)} className="w-full rounded-xl bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 px-3 py-2 text-sm outline-none focus:border-indigo-500">
                                        <option value="MONTHLY">Mensal</option>
                                        <option value="YEARLY">Anual</option>
                                        <option value="LIFETIME">Vitalício</option>
                                    </select>
                                </div>
                            </div>
                            <div className="flex gap-3">
                                <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm py-2.5 rounded-xl transition-colors">
                                    {editingId ? 'Atualizar Plano' : 'Salvar Plano'}
                                </button>
                                {editingId && (
                                    <button type="button" onClick={cancelEdit} className="w-full bg-zinc-200 hover:bg-zinc-300 dark:bg-white/10 dark:hover:bg-white/20 text-zinc-900 dark:text-white font-semibold text-sm py-2.5 rounded-xl transition-colors">
                                        Cancelar
                                    </button>
                                )}
                            </div>
                        </form>
                    </div>
                </div>

                {/* List */}
                <div className="lg:col-span-2">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {loading && <div className="p-4 text-zinc-500 text-sm">Carregando planos...</div>}
                        {!loading && plans.length === 0 && <div className="p-4 text-zinc-500 text-sm">Nenhum plano cadastrado.</div>}
                        {plans.map(p => (
                            <div key={p.id} className="bg-white dark:bg-zinc-900/50 rounded-2xl border border-zinc-200 dark:border-white/10 p-5 shadow-sm flex flex-col">
                                <div className="flex justify-between items-start mb-4">
                                    <div>
                                        <div className="font-bold text-lg">{p.name}</div>
                                        <div className="text-[10px] uppercase tracking-wider font-bold text-indigo-500">{p.type}</div>
                                    </div>
                                    <div className="text-right">
                                        <div className="font-bold text-xl">R$ {p.price}</div>
                                        <div className="text-xs text-zinc-500">{p.billing_cycle === 'MONTHLY' ? '/mês' : p.billing_cycle === 'YEARLY' ? '/ano' : 'único'}</div>
                                    </div>
                                </div>
                                <div className="mt-auto space-y-2 pt-4 border-t border-zinc-100 dark:border-white/5 text-sm text-zinc-600 dark:text-zinc-400">
                                    <div className="flex items-center gap-2">
                                        <svg className="h-4 w-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                        Libera +{p.max_sites} limite de site(s)
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <svg className="h-4 w-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                        Limita a {p.max_events.toLocaleString()} eventos
                                    </div>
                                </div>
                                <div className="mt-4 flex gap-2 pt-4 border-t border-zinc-100 dark:border-white/5">
                                    <button onClick={() => handleEdit(p)} className="flex-1 bg-zinc-100 hover:bg-zinc-200 dark:bg-white/5 dark:hover:bg-white/10 text-zinc-700 dark:text-zinc-300 font-medium text-xs py-2 rounded-lg transition-colors">
                                        Editar
                                    </button>
                                    <button onClick={() => handleDelete(p.id)} className="flex-1 bg-red-50 hover:bg-red-100 dark:bg-red-500/10 dark:hover:bg-red-500/20 text-red-600 dark:text-red-400 font-medium text-xs py-2 rounded-lg transition-colors">
                                        Excluir
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

            </div>
        </Layout>
    );
};
