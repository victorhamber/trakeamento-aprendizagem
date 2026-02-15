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
    className={`rounded-2xl bg-zinc-950/50 border p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] transition-colors ${
      accent === 'blue'
        ? 'border-blue-500/15 hover:border-blue-500/25'
        : accent === 'emerald'
          ? 'border-emerald-500/15 hover:border-emerald-500/25'
          : accent === 'violet'
            ? 'border-violet-500/15 hover:border-violet-500/25'
            : accent === 'amber'
              ? 'border-amber-500/15 hover:border-amber-500/25'
              : 'border-zinc-900/70 hover:border-zinc-800/80'
    }`}
  >
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        {icon && (
          <div className="mt-0.5 h-10 w-10 rounded-2xl bg-zinc-900/50 border border-zinc-800/70 flex items-center justify-center text-zinc-200">
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
