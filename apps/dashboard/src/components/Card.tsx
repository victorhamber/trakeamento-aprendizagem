import React from 'react';

export const Card = ({
  title,
  value,
  hint,
  right,
}: {
  title: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  right?: React.ReactNode;
}) => (
  <div className="rounded-2xl bg-zinc-950 border border-zinc-900 p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="text-xs text-zinc-400">{title}</div>
        <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
        {hint && <div className="mt-2 text-xs text-zinc-500">{hint}</div>}
      </div>
      {right}
    </div>
  </div>
);

