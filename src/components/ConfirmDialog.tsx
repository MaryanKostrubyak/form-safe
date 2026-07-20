import { AlertTriangle } from 'lucide-react';
import { Button } from './Button';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/35 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="formsafe-confirm-title"
        className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-4 shadow-panel dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-full bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
            <AlertTriangle className="size-4" />
          </div>
          <div>
            <h2 id="formsafe-confirm-title" className="text-sm font-semibold text-slate-950 dark:text-white">
              {title}
            </h2>
            <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{description}</p>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant="danger" size="sm" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
