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
    className={`rounded-2xl bg-gradient-to-br from-zinc-950/80 via-zinc-950/60 to-zinc-900/40 border p-5 shadow-[0_12px_30px_rgba(0,0,0,0.35)] transition-all ${
      accent === 'blue'
        ? 'border-blue-500/25 hover:border-blue-500/45'
        : accent === 'emerald'
          ? 'border-emerald-500/25 hover:border-emerald-500/45'
          : accent === 'violet'
            ? 'border-violet-500/25 hover:border-violet-500/45'
            : accent === 'amber'
              ? 'border-amber-500/25 hover:border-amber-500/45'
              : 'border-white/5 hover:border-white/10'
    }`}
  >
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        {icon && (
          <div className="mt-0.5 h-10 w-10 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-zinc-100">
            {icon}
          </div>
        )}
        <div>
          <div className="text-xs text-zinc-500">{title}</div>
          <div className="mt-2 text-2xl font-semibold tracking-tight text-white">{value}</div>
          {hint && <div className="mt-2 text-xs text-zinc-500">{hint}</div>}
        </div>
      </div>
      {right}
    </div>
  </div>
);
