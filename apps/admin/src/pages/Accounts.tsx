import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Layout } from '../components/Layout';

type AccountRow = {
    id: number;
    email: string;
    is_active: boolean;
    bonus_site_limit: number;
    created_at: string;
    plan_name: string | null;
    base_max_sites: number | null;
    sites_count: number;
};

export const AccountsPage = () => {
    const [accounts, setAccounts] = useState<AccountRow[]>([]);
    const [loading, setLoading] = useState(true);

    const load = async () => {
        try {
            const res = await api.get('/admin/accounts');
            setAccounts(res.data);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
    }, []);

    const toggleActive = async (id: number, currentStatus: boolean) => {
        if (!confirm(`Deseja ${currentStatus ? 'desativar' : 'ativar'} esta conta?`)) return;
        try {
            await api.put(`/admin/accounts/${id}`, { is_active: !currentStatus });
            await load();
        } catch (e) {
            alert('Erro ao atualizar status');
        }
    };

    const updateBonus = async (id: number, currentBonus: number) => {
        const newVal = prompt('Novo limite de sites BÔNUS (Add-ons) para este cliente:', String(currentBonus));
        if (newVal === null) return;
        const bonus = parseInt(newVal, 10);
        if (isNaN(bonus)) return;
        try {
            await api.put(`/admin/accounts/${id}`, { bonus_site_limit: bonus });
            await load();
        } catch (e) {
            alert('Erro ao atualizar bônus');
        }
    };

    return (
        <Layout title="Contas de Clientes">
            <div className="bg-white dark:bg-zinc-900/50 rounded-2xl border border-zinc-200 dark:border-white/10 overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-zinc-50 dark:bg-white/5 border-b border-zinc-200 dark:border-white/10 text-zinc-500 dark:text-zinc-400">
                            <tr>
                                <th className="px-5 py-4 font-medium">Cliente</th>
                                <th className="px-5 py-4 font-medium">Plano Atual</th>
                                <th className="px-5 py-4 font-medium">Sites (Uso/Limite)</th>
                                <th className="px-5 py-4 font-medium text-center">Status</th>
                                <th className="px-5 py-4 font-medium text-right">Ações</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-200 dark:divide-white/10">
                            {loading && <tr><td colSpan={5} className="p-8 text-center text-zinc-500">Carregando...</td></tr>}
                            {!loading && accounts.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-zinc-500">Nenhuma conta encontrada.</td></tr>}
                            {accounts.map(acc => {
                                const limit = (acc.base_max_sites || 1) + acc.bonus_site_limit;
                                return (
                                    <tr key={acc.id} className="hover:bg-zinc-50/50 dark:hover:bg-white/[0.02] transition-colors">
                                        <td className="px-5 py-4">
                                            <div className="font-semibold text-zinc-900 dark:text-white">{acc.email || `Conta #${acc.id}`}</div>
                                            <div className="text-xs text-zinc-500 mt-1">Desde {new Date(acc.created_at).toLocaleDateString()}</div>
                                        </td>
                                        <td className="px-5 py-4">
                                            <div className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400">
                                                {acc.plan_name || 'Free / Sem plano'}
                                            </div>
                                        </td>
                                        <td className="px-5 py-4">
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium">{acc.sites_count}</span>
                                                <span className="text-zinc-400">/</span>
                                                <span className={`${limit > acc.sites_count ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>{limit}</span>
                                                {acc.bonus_site_limit > 0 && (
                                                    <span className="text-[10px] bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400 px-1.5 rounded ml-1">
                                                        +{acc.bonus_site_limit} bônus
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-5 py-4 text-center">
                                            <button
                                                onClick={() => toggleActive(acc.id, acc.is_active)}
                                                className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider transition-colors ${acc.is_active
                                                    ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:hover:bg-emerald-500/20'
                                                    : 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20'
                                                    }`}
                                            >
                                                {acc.is_active ? 'Ativo' : 'Bloqueado'}
                                            </button>
                                        </td>
                                        <td className="px-5 py-4 text-right">
                                            <button
                                                onClick={() => updateBonus(acc.id, acc.bonus_site_limit)}
                                                className="text-xs text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300 font-medium"
                                            >
                                                Editar limites
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </Layout>
    );
};
