import type { ReactNode } from 'react';
import { FileText } from 'lucide-react';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description: string;
}

export function EmptyState({ icon, title, description }: EmptyStateProps) {
  return (
    <div className="grid place-items-center rounded-xl border border-dashed border-slate-300 bg-white/70 px-5 py-9 text-center dark:border-slate-700 dark:bg-slate-900/60">
      <div className="mb-3 grid size-10 place-items-center rounded-full bg-brand-50 text-brand-700 dark:bg-brand-950/50 dark:text-brand-100">
        {icon ?? <FileText className="size-5" />}
      </div>
      <h3 className="text-sm font-semibold text-slate-950 dark:text-white">{title}</h3>
      <p className="mt-1 max-w-64 text-xs leading-5 text-slate-500 dark:text-slate-400">{description}</p>
    </div>
  );
}
