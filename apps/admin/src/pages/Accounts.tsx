import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { api } from '../lib/api';
import { Layout } from '../components/Layout';

type AccountRow = {
  id: number;
  name: string | null;
  email: string;
  is_active: boolean;
  bonus_site_limit: number;
  created_at: string;
  expires_at: string | null;
  plan_name: string | null;
  base_max_sites: number | null;
  sites_count: number;
  total_events: number;
  last_activity: string | null;
};

type Plan = { id: number; name: string };

type SortKey = 'email' | 'plan_name' | 'sites_count' | 'total_events' | 'last_activity' | 'created_at';
type SortDir = 'asc' | 'desc';

type Toast = { id: number; message: string; type: 'success' | 'error' };

// ── Toast Container ───────────────────────────────────────────────────────────

const ToastContainer = ({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) => (
  <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 pointer-events-none">
    {toasts.map(t => (
      <div
        key={t.id}
        onClick={() => onDismiss(t.id)}
        className={`pointer-events-auto px-4 py-3 rounded-xl text-sm font-medium shadow-lg border backdrop-blur-xl cursor-pointer animate-[slideUp_0.3s_ease-out] ${
          t.type === 'success'
            ? 'bg-emerald-50/90 text-emerald-800 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/20'
            : 'bg-red-50/90 text-red-800 border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/20'
        }`}
      >
        {t.message}
      </div>
    ))}
  </div>
);

// ── Confirm Modal ─────────────────────────────────────────────────────────────

const ConfirmModal = ({
  title, message, confirmLabel, variant, onConfirm, onCancel,
}: {
  title: string; message: string; confirmLabel: string;
  variant: 'danger' | 'primary';
  onConfirm: () => void; onCancel: () => void;
}) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
    <div className="bg-white dark:bg-zinc-900 rounded-2xl p-6 w-full max-w-sm shadow-2xl border border-zinc-200 dark:border-white/10">
      <h3 className="text-lg font-bold mb-2">{title}</h3>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-5">{message}</p>
      <div className="flex gap-3">
        <button onClick={onCancel} className="flex-1 bg-zinc-100 dark:bg-white/5 hover:bg-zinc-200 dark:hover:bg-white/10 text-zinc-900 dark:text-white font-semibold text-sm py-2.5 rounded-xl transition-colors">
          Cancelar
        </button>
        <button onClick={onConfirm} className={`flex-1 font-semibold text-sm py-2.5 rounded-xl transition-colors text-white ${
          variant === 'danger' ? 'bg-red-600 hover:bg-red-500' : 'bg-indigo-600 hover:bg-indigo-500'
        }`}>
          {confirmLabel}
        </button>
      </div>
    </div>
  </div>
);

// ── Sort Arrow ────────────────────────────────────────────────────────────────

const SortArrow = ({ active, dir }: { active: boolean; dir: SortDir }) => (
  <span className={`ml-1 inline-block transition-opacity ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-40'}`}>
    {dir === 'asc' ? '↑' : '↓'}
  </span>
);

// ── Helpers ───────────────────────────────────────────────────────────────────

const formatNumber = (n: number) => n.toLocaleString('pt-BR');

const timeAgo = (dateStr: string | null): string => {
  if (!dateStr) return 'Sem atividade';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Agora';
  if (mins < 60) return `${mins}min atrás`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h atrás`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d atrás`;
  return new Date(dateStr).toLocaleDateString('pt-BR');
};

// ── Main Component ────────────────────────────────────────────────────────────

export const AccountsPage = () => {
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);

  // Search & filters
  const [search, setSearch] = useState('');
  const [filterPlan, setFilterPlan] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'blocked'>('all');

  // Sort
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Modals
  const [planModalAccId, setPlanModalAccId] = useState<number | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('0');
  const [bonusModal, setBonusModal] = useState<{ accId: number; current: number } | null>(null);
  const [bonusValue, setBonusValue] = useState('');
  const [confirmAction, setConfirmAction] = useState<{ title: string; message: string; label: string; variant: 'danger' | 'primary'; action: () => Promise<void> } | null>(null);

  // Toast
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastIdRef = useRef(0);

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const load = async () => {
    try {
      const [accRes, plansRes] = await Promise.all([
        api.get('/admin/accounts'),
        api.get('/admin/plans'),
      ]);
      setAccounts(accRes.data);
      setPlans(plansRes.data);
    } catch {
      showToast('Erro ao carregar dados', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // ── Filtering & Sorting ──────────────────────────────────────────────────

  const filtered = useMemo(() => {
    let result = accounts;

    if (search.trim()) {
      const q = search.toLowerCase().trim();
      result = result.filter(a =>
        (a.email || '').toLowerCase().includes(q) ||
        (a.name || '').toLowerCase().includes(q) ||
        String(a.id).includes(q)
      );
    }

    if (filterPlan !== 'all') {
      if (filterPlan === 'none') {
        result = result.filter(a => !a.plan_name);
      } else {
        result = result.filter(a => a.plan_name === filterPlan);
      }
    }

    if (filterStatus !== 'all') {
      result = result.filter(a => filterStatus === 'active' ? a.is_active : !a.is_active);
    }

    result = [...result].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'email': cmp = (a.email || '').localeCompare(b.email || ''); break;
        case 'plan_name': cmp = (a.plan_name || '').localeCompare(b.plan_name || ''); break;
        case 'sites_count': cmp = a.sites_count - b.sites_count; break;
        case 'total_events': cmp = Number(a.total_events) - Number(b.total_events); break;
        case 'last_activity':
          cmp = (a.last_activity ? new Date(a.last_activity).getTime() : 0) - (b.last_activity ? new Date(b.last_activity).getTime() : 0);
          break;
        case 'created_at': cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime(); break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [accounts, search, filterPlan, filterStatus, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  // ── Stats ────────────────────────────────────────────────────────────────

  const stats = useMemo(() => ({
    total: accounts.length,
    active: accounts.filter(a => a.is_active).length,
    blocked: accounts.filter(a => !a.is_active).length,
    withPlan: accounts.filter(a => a.plan_name).length,
  }), [accounts]);

  // ── Actions ──────────────────────────────────────────────────────────────

  const openPlanModal = (acc: AccountRow) => {
    setPlanModalAccId(acc.id);
    const currentPlan = plans.find(p => p.name === acc.plan_name);
    setSelectedPlanId(currentPlan ? String(currentPlan.id) : '0');
  };

  const assignPlan = async () => {
    if (!planModalAccId) return;
    try {
      await api.put(`/admin/accounts/${planModalAccId}`, {
        active_plan_id: selectedPlanId === '0' ? null : parseInt(selectedPlanId, 10),
      });
      setPlanModalAccId(null);
      showToast('Plano atualizado com sucesso');
      await load();
    } catch {
      showToast('Erro ao atualizar plano', 'error');
    }
  };

  const requestToggleActive = (acc: AccountRow) => {
    const willBlock = acc.is_active;
    setConfirmAction({
      title: willBlock ? 'Bloquear Conta' : 'Ativar Conta',
      message: willBlock
        ? `Deseja bloquear a conta "${acc.email}"? O cliente perderá acesso ao dashboard.`
        : `Deseja reativar a conta "${acc.email}"?`,
      label: willBlock ? 'Bloquear' : 'Ativar',
      variant: willBlock ? 'danger' : 'primary',
      action: async () => {
        try {
          await api.put(`/admin/accounts/${acc.id}`, { is_active: !acc.is_active });
          showToast(willBlock ? 'Conta bloqueada' : 'Conta ativada');
          await load();
        } catch {
          showToast('Erro ao atualizar status', 'error');
        }
      },
    });
  };

  const openBonusModal = (acc: AccountRow) => {
    setBonusModal({ accId: acc.id, current: acc.bonus_site_limit });
    setBonusValue(String(acc.bonus_site_limit));
  };

  const saveBonus = async () => {
    if (!bonusModal) return;
    const bonus = parseInt(bonusValue, 10);
    if (isNaN(bonus) || bonus < 0) {
      showToast('Valor inválido', 'error');
      return;
    }
    try {
      await api.put(`/admin/accounts/${bonusModal.accId}`, { bonus_site_limit: bonus });
      setBonusModal(null);
      showToast('Limite de bônus atualizado');
      await load();
    } catch {
      showToast('Erro ao atualizar bônus', 'error');
    }
  };

  // ── Unique plan names for filter ─────────────────────────────────────────

  const uniquePlans = useMemo(() => {
    const names = new Set(accounts.map(a => a.plan_name).filter(Boolean) as string[]);
    return Array.from(names).sort();
  }, [accounts]);

  // ── Header with stats ────────────────────────────────────────────────────

  const headerRight = (
    <div className="flex items-center gap-4 text-xs font-medium">
      <span className="text-zinc-500 dark:text-zinc-400">{stats.total} total</span>
      <span className="text-emerald-600 dark:text-emerald-400">{stats.active} ativos</span>
      {stats.blocked > 0 && <span className="text-red-500">{stats.blocked} bloqueados</span>}
    </div>
  );

  // ── Column Header ────────────────────────────────────────────────────────

  const Th = ({ label, sortId, className = '' }: { label: string; sortId: SortKey; className?: string }) => (
    <th
      onClick={() => toggleSort(sortId)}
      className={`px-5 py-4 font-medium cursor-pointer select-none group hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors ${className}`}
    >
      {label}
      <SortArrow active={sortKey === sortId} dir={sortDir} />
    </th>
  );

  return (
    <Layout title="Contas de Clientes" right={headerRight}>
      {/* Search & Filters */}
      <div className="mb-5 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" strokeLinecap="round" />
          </svg>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Pesquisar por email, nome ou ID..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 transition-all"
          />
          {search && (
            <button onClick={() => setSearch('')} title="Limpar pesquisa" className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 18 18 6M6 6l12 12" /></svg>
            </button>
          )}
        </div>

        <select
          value={filterPlan}
          onChange={e => setFilterPlan(e.target.value)}
          title="Filtrar por plano"
          className="px-3 py-2.5 rounded-xl bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 text-sm outline-none focus:border-indigo-500 transition-all min-w-[160px]"
        >
          <option value="all">Todos os planos</option>
          <option value="none">Sem plano</option>
          {uniquePlans.map(p => <option key={p} value={p}>{p}</option>)}
        </select>

        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value as typeof filterStatus)}
          title="Filtrar por status"
          className="px-3 py-2.5 rounded-xl bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 text-sm outline-none focus:border-indigo-500 transition-all min-w-[130px]"
        >
          <option value="all">Todos</option>
          <option value="active">Ativos</option>
          <option value="blocked">Bloqueados</option>
        </select>
      </div>

      {/* Results count when filtering */}
      {(search || filterPlan !== 'all' || filterStatus !== 'all') && (
        <div className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
          {filtered.length} de {accounts.length} contas
          <button onClick={() => { setSearch(''); setFilterPlan('all'); setFilterStatus('all'); }} className="ml-2 text-indigo-500 hover:text-indigo-400 font-medium">
            Limpar filtros
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white dark:bg-zinc-900/50 rounded-2xl border border-zinc-200 dark:border-white/10 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 dark:bg-white/5 border-b border-zinc-200 dark:border-white/10 text-zinc-500 dark:text-zinc-400">
              <tr>
                <Th label="Cliente" sortId="email" />
                <Th label="Plano" sortId="plan_name" />
                <Th label="Sites" sortId="sites_count" />
                <Th label="Eventos" sortId="total_events" />
                <Th label="Última Atividade" sortId="last_activity" />
                <th className="px-5 py-4 font-medium text-center">Status</th>
                <th className="px-5 py-4 font-medium text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-white/10">
              {loading && (
                <tr><td colSpan={7} className="p-8 text-center text-zinc-500">Carregando...</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={7} className="p-8 text-center text-zinc-500">
                  {accounts.length === 0 ? 'Nenhuma conta encontrada.' : 'Nenhum resultado para os filtros aplicados.'}
                </td></tr>
              )}
              {filtered.map(acc => {
                const limit = (acc.base_max_sites || 1) + acc.bonus_site_limit;
                return (
                  <tr key={acc.id} className="hover:bg-zinc-50/50 dark:hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-4">
                      <div className="font-semibold text-zinc-900 dark:text-white">{acc.name || acc.email || `Conta #${acc.id}`}</div>
                      {acc.name && <div className="text-xs text-zinc-500 truncate max-w-[200px]">{acc.email}</div>}
                      <div className="text-[10px] text-zinc-400 mt-0.5">Desde {new Date(acc.created_at).toLocaleDateString('pt-BR')}</div>
                    </td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium ${
                        acc.plan_name
                          ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400'
                          : 'bg-zinc-100 text-zinc-500 dark:bg-white/5 dark:text-zinc-500'
                      }`}>
                        {acc.plan_name || 'Sem plano'}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium">{acc.sites_count}</span>
                        <span className="text-zinc-400">/</span>
                        <span className={limit > acc.sites_count ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}>{limit}</span>
                        {acc.bonus_site_limit > 0 && (
                          <span className="text-[10px] bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400 px-1.5 rounded">
                            +{acc.bonus_site_limit}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-4 tabular-nums">
                      <span className="text-zinc-700 dark:text-zinc-300">{formatNumber(Number(acc.total_events))}</span>
                    </td>
                    <td className="px-5 py-4">
                      <span className={`text-xs ${acc.last_activity ? 'text-zinc-600 dark:text-zinc-400' : 'text-zinc-400 dark:text-zinc-600'}`}>
                        {timeAgo(acc.last_activity)}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-center">
                      <button
                        onClick={() => requestToggleActive(acc)}
                        className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider transition-colors ${
                          acc.is_active
                            ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:hover:bg-emerald-500/20'
                            : 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20'
                        }`}
                      >
                        {acc.is_active ? 'Ativo' : 'Bloqueado'}
                      </button>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div className="flex flex-col items-end gap-1.5">
                        <button
                          onClick={() => openBonusModal(acc)}
                          className="text-[11px] font-bold uppercase tracking-wider text-amber-600 hover:text-amber-500 dark:text-amber-400 dark:hover:text-amber-300"
                        >
                          Editar Limites
                        </button>
                        <button
                          onClick={() => openPlanModal(acc)}
                          className="text-[11px] font-bold uppercase tracking-wider text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300"
                        >
                          Alterar Plano
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Plan Assignment Modal */}
      {planModalAccId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl p-6 w-full max-w-sm shadow-2xl border border-zinc-200 dark:border-white/10">
            <h3 className="text-lg font-bold mb-4">Atribuir Plano</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Selecione o Plano</label>
                <select
                  value={selectedPlanId}
                  onChange={e => setSelectedPlanId(e.target.value)}
                  title="Selecione o plano"
                  className="w-full rounded-xl bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                >
                  <option value="0">Free / Sem Plano</option>
                  {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setPlanModalAccId(null)} className="flex-1 bg-zinc-100 dark:bg-white/5 hover:bg-zinc-200 dark:hover:bg-white/10 text-zinc-900 dark:text-white font-semibold text-sm py-2 rounded-xl transition-colors">
                  Cancelar
                </button>
                <button onClick={assignPlan} className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm py-2 rounded-xl transition-colors">
                  Confirmar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bonus Edit Modal */}
      {bonusModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl p-6 w-full max-w-sm shadow-2xl border border-zinc-200 dark:border-white/10">
            <h3 className="text-lg font-bold mb-2">Editar Limite de Bônus</h3>
            <p className="text-xs text-zinc-500 mb-4">Sites extras além do plano base.</p>
            <input
              type="number"
              min={0}
              value={bonusValue}
              onChange={e => setBonusValue(e.target.value)}
              autoFocus
              onKeyDown={e => e.key === 'Enter' && saveBonus()}
              placeholder="0"
              title="Limite de sites bônus"
              className="w-full rounded-xl bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 px-3 py-2.5 text-sm outline-none focus:border-indigo-500 mb-4"
            />
            <div className="flex gap-3">
              <button onClick={() => setBonusModal(null)} className="flex-1 bg-zinc-100 dark:bg-white/5 hover:bg-zinc-200 dark:hover:bg-white/10 text-zinc-900 dark:text-white font-semibold text-sm py-2.5 rounded-xl transition-colors">
                Cancelar
              </button>
              <button onClick={saveBonus} className="flex-1 bg-amber-600 hover:bg-amber-500 text-white font-semibold text-sm py-2.5 rounded-xl transition-colors">
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Action Modal */}
      {confirmAction && (
        <ConfirmModal
          title={confirmAction.title}
          message={confirmAction.message}
          confirmLabel={confirmAction.label}
          variant={confirmAction.variant}
          onCancel={() => setConfirmAction(null)}
          onConfirm={async () => {
            await confirmAction.action();
            setConfirmAction(null);
          }}
        />
      )}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </Layout>
  );
};
