import React from 'react';
import { cn } from '../lib/utils';
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface CardProps {
  title: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  right?: React.ReactNode;
  icon?: React.ReactNode;
  accent?: 'zinc' | 'blue' | 'emerald' | 'violet' | 'amber';
  change?: number;
  className?: string;
  delay?: number;
}

export const Card = ({
  title,
  value,
  hint,
  right,
  icon,
  accent = 'zinc',
  change,
  className,
  delay = 0
}: CardProps) => {
  const trend = change === undefined ? null : change > 0 ? "up" : change < 0 ? "down" : "neutral";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay }}
      className={cn(
        "glass-card p-6 relative overflow-hidden group hover:border-primary/50 transition-colors duration-300",
        className
      )}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
      
      <div className="relative flex items-start justify-between">
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
          <div className="flex items-baseline gap-2">
            <h3 className="text-2xl font-bold text-foreground tracking-tight">{value}</h3>
          </div>
          
          {(change !== undefined || hint) && (
            <div className="flex items-center gap-2 mt-1">
              {change !== undefined && (
                <div className={cn(
                  "flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded-full bg-background/50 border border-border",
                  trend === "up" && "text-success border-success/20 bg-success/10",
                  trend === "down" && "text-destructive border-destructive/20 bg-destructive/10",
                  trend === "neutral" && "text-muted-foreground"
                )}>
                  {trend === "up" && <TrendingUp className="h-3 w-3" />}
                  {trend === "down" && <TrendingDown className="h-3 w-3" />}
                  {trend === "neutral" && <Minus className="h-3 w-3" />}
                  <span>{change > 0 ? "+" : ""}{change}%</span>
                </div>
              )}
              {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
            </div>
          )}
        </div>

        {(icon || right) && (
          <div className="flex items-center gap-2">
            {right}
            {icon && (
              <div className={cn(
                "flex h-10 w-10 items-center justify-center rounded-xl border shadow-sm transition-all duration-300",
                accent === 'blue' && "bg-blue-500/10 text-blue-500 border-blue-500/20 group-hover:bg-blue-500/20 group-hover:shadow-[0_0_20px_-5px_rgba(59,130,246,0.4)]",
                accent === 'emerald' && "bg-emerald-500/10 text-emerald-500 border-emerald-500/20 group-hover:bg-emerald-500/20 group-hover:shadow-[0_0_20px_-5px_rgba(16,185,129,0.4)]",
                accent === 'violet' && "bg-violet-500/10 text-violet-500 border-violet-500/20 group-hover:bg-violet-500/20 group-hover:shadow-[0_0_20px_-5px_rgba(139,92,246,0.4)]",
                accent === 'amber' && "bg-amber-500/10 text-amber-500 border-amber-500/20 group-hover:bg-amber-500/20 group-hover:shadow-[0_0_20px_-5px_rgba(245,158,11,0.4)]",
                accent === 'zinc' && "bg-primary/10 text-primary border-primary/20 group-hover:bg-primary/20 group-hover:shadow-[0_0_20px_-5px_hsl(199,89%,48%,0.4)]"
              )}>
                {icon}
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
};
