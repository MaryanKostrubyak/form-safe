import { CheckCircle2, CircleAlert, Info } from 'lucide-react';
import { cn } from '../lib/cn';

export type ToastTone = 'success' | 'error' | 'info';

interface ToastProps {
  message: string;
  tone?: ToastTone;
}

const icons = {
  success: CheckCircle2,
  error: CircleAlert,
  info: Info,
};

export function Toast({ message, tone = 'info' }: ToastProps) {
  const Icon = icons[tone];
  return (
    <div
      className={cn(
        'fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border bg-white px-3 py-2 text-xs font-semibold shadow-panel dark:bg-slate-900',
        tone === 'success' && 'border-emerald-200 text-emerald-700 dark:border-emerald-900 dark:text-emerald-300',
        tone === 'error' && 'border-rose-200 text-rose-700 dark:border-rose-900 dark:text-rose-300',
        tone === 'info' && 'border-slate-200 text-slate-700 dark:border-slate-700 dark:text-slate-200',
      )}
    >
      <Icon className="size-4" />
      {message}
    </div>
  );
}
