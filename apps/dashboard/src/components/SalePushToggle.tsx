import { useTheme } from '../state/theme';
import { useAuth } from '../state/auth';
import { useWebPush } from '../hooks/useWebPush';

/** Ícone carteira / venda — distinto do sino de notificações globais */
const IconSaleAlert = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 7V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-1" />
    <path d="M16 12h.01" />
    <rect x="14" y="9" width="8" height="6" rx="1" />
  </svg>
);

export function SalePushToggle() {
  const { token } = useAuth();
  const { theme } = useTheme();
  const webPush = useWebPush(!!token);

  if (!token) return null;

  const isDark = theme === 'dark';

  const disabled =
    webPush.busy ||
    !webPush.supported ||
    webPush.serverEnabled === null ||
    webPush.serverEnabled === false;

  let title = !webPush.supported
    ? 'Este navegador não suporta alertas de venda por push'
    : webPush.serverEnabled === false
      ? 'Configure WEB_PUSH_VAPID_* na API'
      : webPush.subscribed
        ? 'Alertas de venda ativos — clique para desativar'
        : 'Ativar alertas de venda (push + som ao fechar venda)';
  if (webPush.error) title = `${title}. Erro: ${webPush.error}`;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          if (disabled) return;
          if (webPush.subscribed) void webPush.unsubscribe();
          else void webPush.subscribe();
        }}
        disabled={disabled}
        title={title}
        aria-label={title}
        className={`h-9 w-9 rounded-xl border flex items-center justify-center transition-all hover:scale-105 disabled:opacity-40 disabled:hover:scale-100 disabled:cursor-not-allowed ${
          webPush.subscribed
            ? isDark
              ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25'
              : 'border-emerald-500/40 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
            : isDark
              ? 'border-white/10 bg-white/5 text-zinc-400 hover:text-emerald-400 hover:bg-emerald-500/10'
              : 'border-zinc-200 bg-zinc-50 text-zinc-500 hover:text-emerald-700 hover:bg-emerald-50'
        }`}
      >
        <IconSaleAlert />
      </button>
    </div>
  );
}
