import React from 'react';

export const Card = ({
  title,
  value,
  hint,
  right,
  icon,
  accent = 'zinc',
}: {
  title: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  right?: React.ReactNode;
  icon?: React.ReactNode;
  accent?: 'zinc' | 'blue' | 'emerald' | 'violet' | 'amber';
}) => (
  <div
    className={`rounded-2xl border p-5 transition-all select-none
      bg-white dark:bg-gradient-to-br dark:from-zinc-950/80 dark:via-zinc-950/60 dark:to-zinc-900/40
      shadow-sm dark:shadow-[0_12px_30px_rgba(0,0,0,0.35)] ${
      accent === 'blue'
        ? 'border-blue-200 dark:border-blue-500/25 hover:border-blue-300 dark:hover:border-blue-500/45'
        : accent === 'emerald'
          ? 'border-emerald-200 dark:border-emerald-500/25 hover:border-emerald-300 dark:hover:border-emerald-500/45'
          : accent === 'violet'
            ? 'border-violet-200 dark:border-violet-500/25 hover:border-violet-300 dark:hover:border-violet-500/45'
            : accent === 'amber'
              ? 'border-amber-200 dark:border-amber-500/25 hover:border-amber-300 dark:hover:border-amber-500/45'
              : 'border-zinc-200 dark:border-white/5 hover:border-zinc-300 dark:hover:border-white/10'
    }`}
  >
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        {icon && (
          <div className="mt-0.5 h-10 w-10 rounded-2xl bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 flex items-center justify-center text-zinc-600 dark:text-zinc-100">
            {icon}
          </div>
        )}
        <div>
          <div className="text-xs text-zinc-500 dark:text-zinc-500">{title}</div>
          <div className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white">{value}</div>
          {hint && <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-500">{hint}</div>}
        </div>
      </div>
      {right}
    </div>
  </div>
);
